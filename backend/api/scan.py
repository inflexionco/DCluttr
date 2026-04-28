"""
Scan & Index API endpoints.

POST /api/scan/start            → create and start a scan job
GET  /api/scan/{job_id}/status  → poll job status (REST)
WS   /api/scan/{job_id}/progress → WebSocket stream of live progress events
GET  /api/scan/{job_id}/results → final scan summary
POST /api/scan/hash             → trigger SHA-256 hashing for a device
POST /api/scan/duplicates       → detect exact duplicates across devices
"""

import asyncio
import json
import logging
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.hasher import detect_exact_duplicates, hash_all_unhashed
from backend.core.scanner import FileScanner, ScanProgress
from backend.db.database import get_db
from backend.db.models import Device, DuplicateGroup, File, ScanJob

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/scan", tags=["scan"])

# In-memory registry of active scan progress (job_id → ScanProgress)
# Used to feed WebSocket subscribers without DB polling.
_active_progress: dict[int, ScanProgress] = {}
_progress_events: dict[int, asyncio.Event] = {}


# ── Request/Response schemas ──────────────────────────────────────────────────

class ScanStartRequest(BaseModel):
    device_ids: list[int] = Field(..., min_length=1)
    file_types: Optional[list[str]] = None  # images | videos | documents | audio
    scan_depth: str = Field("deep", pattern="^(shallow|deep)$")
    exclusion_patterns: Optional[list[str]] = None
    # Optional per-device path overrides: {device_id: path}
    scan_paths: Optional[dict[int, str]] = None


class ScanStartResponse(BaseModel):
    job_id: int
    status: str


class ScanStatusResponse(BaseModel):
    job_id: int
    status: str
    files_found: int
    files_indexed: int
    current_path: str
    error: Optional[str] = None


class ScanResultsResponse(BaseModel):
    job_id: int
    status: str
    files_found: int
    files_indexed: int
    by_type: dict[str, int]
    by_size: dict[str, int]
    error: Optional[str] = None


class HashRequest(BaseModel):
    device_id: int


class DuplicateDetectRequest(BaseModel):
    device_ids: list[int] = Field(..., min_length=1)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_progress_callback(job_id: int):
    """Return a synchronous callback that updates the shared progress dict."""

    def callback(progress: ScanProgress) -> None:
        _active_progress[job_id] = progress
        event = _progress_events.get(job_id)
        if event:
            event.set()

    return callback


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/start", response_model=ScanStartResponse)
async def start_scan(
    body: ScanStartRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Create a ScanJob and start it as a background asyncio task."""
    # Validate devices exist
    result = await db.execute(select(Device).where(Device.id.in_(body.device_ids)))
    devices = list(result.scalars().all())
    if len(devices) != len(body.device_ids):
        raise HTTPException(status_code=404, detail="One or more device IDs not found")

    job = ScanJob(
        device_ids=json.dumps(body.device_ids),
        file_types=json.dumps(body.file_types) if body.file_types else None,
        scan_depth=body.scan_depth,
        exclusion_patterns=json.dumps(body.exclusion_patterns)
        if body.exclusion_patterns
        else None,
    )
    db.add(job)
    await db.flush()
    job_id = job.id

    # Register progress tracking
    _active_progress[job_id] = ScanProgress(job_id=job_id, status="pending")
    _progress_events[job_id] = asyncio.Event()

    # scan_paths keys are ints but JSON round-trips them as strings — normalise here
    scan_paths: dict[int, str] | None = None
    if body.scan_paths:
        scan_paths = {int(k): v for k, v in body.scan_paths.items()}

    # Launch background task — uses a fresh DB session so it doesn't conflict
    asyncio.create_task(_run_scan_task(job_id, body.device_ids, scan_paths))

    return ScanStartResponse(job_id=job_id, status="pending")


async def _run_scan_task(
    job_id: int,
    device_ids: list[int],
    scan_paths: dict[int, str] | None = None,
) -> None:
    """Background task: runs the scan job with its own DB session."""
    from backend.db.database import AsyncSessionLocal  # avoid circular import

    async with AsyncSessionLocal() as db:
        try:
            result = await db.execute(select(ScanJob).where(ScanJob.id == job_id))
            job = result.scalar_one_or_none()
            if job is None:
                return

            result = await db.execute(select(Device).where(Device.id.in_(device_ids)))
            devices = list(result.scalars().all())

            scanner = FileScanner(db)
            callback = _make_progress_callback(job_id)
            await scanner.run_scan_job(job, devices, progress_callback=callback, scan_paths=scan_paths)
            await db.commit()
        except Exception as exc:
            logger.exception("Scan task %d failed: %s", job_id, exc)
            await db.rollback()


@router.get("/{job_id}/status", response_model=ScanStatusResponse)
async def get_scan_status(
    job_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(select(ScanJob).where(ScanJob.id == job_id))
    job = result.scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="Scan job not found")

    return ScanStatusResponse(
        job_id=job.id,
        status=job.status,
        files_found=job.files_found,
        files_indexed=job.files_indexed,
        current_path=job.current_path or "",
        error=job.error_message,
    )


@router.websocket("/{job_id}/progress")
async def scan_progress_ws(job_id: int, websocket: WebSocket):
    """
    WebSocket endpoint that streams ScanProgress JSON events until the scan
    completes or the client disconnects.
    """
    await websocket.accept()

    try:
        # If job not yet known, wait briefly
        for _ in range(20):
            if job_id in _progress_events:
                break
            await asyncio.sleep(0.1)

        if job_id not in _progress_events:
            await websocket.send_json({"error": "Job not found or not started"})
            await websocket.close()
            return

        event = _progress_events[job_id]

        while True:
            # Wait for a new progress update (with timeout to send heartbeat)
            try:
                await asyncio.wait_for(asyncio.shield(event.wait()), timeout=2.0)
                event.clear()
            except asyncio.TimeoutError:
                # Send heartbeat ping so client knows connection is alive
                await websocket.send_json({"heartbeat": True})
                continue

            progress = _active_progress.get(job_id)
            if progress is None:
                break

            await websocket.send_json(progress.to_dict())

            if progress.status in ("done", "failed"):
                break

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.warning("WebSocket error for job %d: %s", job_id, exc)
    finally:
        # Cleanup only after job is terminal
        progress = _active_progress.get(job_id)
        if progress and progress.status in ("done", "failed"):
            _active_progress.pop(job_id, None)
            _progress_events.pop(job_id, None)


@router.get("/{job_id}/results", response_model=ScanResultsResponse)
async def get_scan_results(
    job_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(select(ScanJob).where(ScanJob.id == job_id))
    job = result.scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="Scan job not found")
    if job.status not in ("done", "failed"):
        raise HTTPException(status_code=202, detail="Scan still in progress")

    # Build by_type summary from DB
    from sqlalchemy import func as sa_func

    file_ids_result = await db.execute(
        select(File.extension, sa_func.count(File.id), sa_func.sum(File.size)).where(
            File.device_id.in_(json.loads(job.device_ids))
        ).group_by(File.extension)
    )
    rows = file_ids_result.all()

    by_type: dict[str, int] = {}
    by_size: dict[str, int] = {}
    for ext, count, total_size in rows:
        from backend.core.scanner import _classify_extension
        cat = _classify_extension(ext or "")
        by_type[cat] = by_type.get(cat, 0) + count
        by_size[cat] = by_size.get(cat, 0) + (total_size or 0)

    return ScanResultsResponse(
        job_id=job.id,
        status=job.status,
        files_found=job.files_found,
        files_indexed=job.files_indexed,
        by_type=by_type,
        by_size=by_size,
        error=job.error_message,
    )


@router.post("/hash")
async def hash_device_files(
    body: HashRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Trigger SHA-256 hashing for all un-hashed files on a device."""
    result = await db.execute(select(Device).where(Device.id == body.device_id))
    device = result.scalar_one_or_none()
    if device is None:
        raise HTTPException(status_code=404, detail="Device not found")

    # Run hashing as a background task with its own session
    asyncio.create_task(_run_hash_task(body.device_id))
    return {"status": "hashing_started", "device_id": body.device_id}


async def _run_hash_task(device_id: int) -> None:
    from backend.db.database import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        try:
            count = await hash_all_unhashed(device_id, db)
            await db.commit()
            logger.info("Hashed %d files for device %d", count, device_id)
        except Exception as exc:
            logger.exception("Hash task failed for device %d: %s", device_id, exc)
            await db.rollback()


@router.post("/duplicates")
async def find_duplicates(
    body: DuplicateDetectRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Run exact duplicate detection (SHA-256) for the given devices."""
    groups = await detect_exact_duplicates(body.device_ids, db)
    return {
        "groups_created": len(groups),
        "group_ids": [g.id for g in groups],
    }


@router.get("/jobs")
async def list_scan_jobs(
    db: Annotated[AsyncSession, Depends(get_db)],
    limit: int = 20,
):
    result = await db.execute(
        select(ScanJob).order_by(ScanJob.created_at.desc()).limit(limit)
    )
    jobs = result.scalars().all()
    return [
        {
            "id": j.id,
            "status": j.status,
            "files_found": j.files_found,
            "files_indexed": j.files_indexed,
            "scan_depth": j.scan_depth,
            "created_at": j.created_at.isoformat() if j.created_at else None,
            "completed_at": j.completed_at.isoformat() if j.completed_at else None,
        }
        for j in jobs
    ]
