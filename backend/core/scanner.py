"""
Async filesystem scanner for DCluttr.
Walks local filesystem directories, emits progress events via callback,
and persists file records to the database.
"""

import asyncio
import json
import mimetypes
import os
from collections.abc import AsyncGenerator, Callable
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from backend.db.models import Device, File, ScanJob

# File type → list of extensions
FILE_TYPE_MAP: dict[str, set[str]] = {
    "images": {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tiff", ".webp", ".heic", ".heif", ".raw"},
    "videos": {".mp4", ".mov", ".avi", ".mkv", ".m4v", ".wmv", ".flv", ".3gp"},
    "documents": {".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt", ".rtf", ".odt", ".pages", ".numbers", ".key"},
    "audio": {".mp3", ".m4a", ".aac", ".wav", ".flac", ".ogg", ".wma", ".aiff"},
}

# Default exclusion patterns
DEFAULT_EXCLUSIONS = {
    "node_modules", ".git", ".svn", "__pycache__", ".DS_Store",
    "Thumbs.db", "$RECYCLE.BIN", "System Volume Information",
    ".Spotlight-V100", ".Trashes", ".fseventsd",
}


@dataclass
class ScanProgress:
    job_id: int
    status: str  # running | done | failed
    files_found: int = 0
    files_indexed: int = 0
    current_path: str = ""
    error: Optional[str] = None
    # Summary filled on completion
    by_type: dict[str, int] = field(default_factory=dict)
    by_size: dict[str, int] = field(default_factory=dict)  # type → total bytes

    def to_dict(self) -> dict:
        return {
            "job_id": self.job_id,
            "status": self.status,
            "files_found": self.files_found,
            "files_indexed": self.files_indexed,
            "current_path": self.current_path,
            "error": self.error,
            "by_type": self.by_type,
            "by_size": self.by_size,
        }


ProgressCallback = Callable[[ScanProgress], None]


def _classify_extension(ext: str) -> str:
    """Return the file category for a given extension."""
    ext_lower = ext.lower()
    for category, extensions in FILE_TYPE_MAP.items():
        if ext_lower in extensions:
            return category
    return "other"


def _should_exclude(name: str, exclusion_patterns: set[str]) -> bool:
    """Return True if a directory/file name matches any exclusion pattern."""
    return name in exclusion_patterns or name.startswith(".")


async def _walk_directory(
    root: Path,
    max_depth: Optional[int],
    exclusion_patterns: set[str],
    allowed_extensions: Optional[set[str]],
) -> AsyncGenerator[Path, None]:
    """
    Async generator that yields file Paths found under `root`.
    Respects depth limits and exclusion patterns.
    Uses asyncio.to_thread to avoid blocking the event loop on large dirs.
    """

    async def _recurse(current: Path, depth: int) -> AsyncGenerator[Path, None]:
        if max_depth is not None and depth > max_depth:
            return

        try:
            entries = await asyncio.to_thread(list, current.iterdir())
        except PermissionError:
            return

        for entry in entries:
            if _should_exclude(entry.name, exclusion_patterns):
                continue
            if entry.is_symlink():
                continue
            if entry.is_dir():
                async for f in _recurse(entry, depth + 1):
                    yield f
            elif entry.is_file():
                if allowed_extensions is None or entry.suffix.lower() in allowed_extensions:
                    yield entry

    async for path in _recurse(root, 0):
        yield path


class FileScanner:
    """
    Orchestrates scanning a list of device root paths, writing discovered
    files to the database, and broadcasting progress updates.
    """

    BATCH_SIZE = 100  # flush to DB every N files

    def __init__(self, db: AsyncSession):
        self.db = db

    async def run_scan_job(
        self,
        job: ScanJob,
        devices: list[Device],
        progress_callback: Optional[ProgressCallback] = None,
        scan_paths: Optional[dict[int, str]] = None,
    ) -> ScanProgress:
        """
        Execute a scan job end-to-end.
        Updates the ScanJob row in-place and calls progress_callback periodically.
        """
        progress = ScanProgress(job_id=job.id, status="running")
        job.status = "running"
        job.started_at = datetime.utcnow()
        await self.db.flush()

        # Parse scan config from job
        device_ids: list[int] = json.loads(job.device_ids)
        file_types: Optional[list[str]] = json.loads(job.file_types) if job.file_types else None
        exclusion_patterns: set[str] = DEFAULT_EXCLUSIONS.copy()
        if job.exclusion_patterns:
            exclusion_patterns |= set(json.loads(job.exclusion_patterns))
        max_depth = 3 if job.scan_depth == "shallow" else None

        # Build allowed extensions set
        allowed_extensions: Optional[set[str]] = None
        if file_types:
            allowed_extensions = set()
            for ft in file_types:
                allowed_extensions |= FILE_TYPE_MAP.get(ft, set())

        # Map device_id → Device
        device_map = {d.id: d for d in devices if d.id in device_ids}

        pending_files: list[File] = []

        try:
            for device_id in device_ids:
                device = device_map.get(device_id)
                if device is None:
                    continue

                conn_info = json.loads(device.connection_info) if device.connection_info else {}
                # Use caller-supplied path override if provided, else device root
                if scan_paths and device_id in scan_paths:
                    root_path = Path(scan_paths[device_id])
                else:
                    root_path = Path(conn_info.get("path", "/"))

                if not root_path.exists():
                    continue

                async for file_path in _walk_directory(
                    root_path, max_depth, exclusion_patterns, allowed_extensions
                ):
                    progress.files_found += 1
                    progress.current_path = str(file_path)

                    stat = await asyncio.to_thread(file_path.stat)
                    ext = file_path.suffix.lower()
                    category = _classify_extension(ext)

                    # Guess MIME
                    mime, _ = mimetypes.guess_type(str(file_path))

                    db_file = File(
                        device_id=device_id,
                        path=str(file_path),
                        filename=file_path.name,
                        extension=ext if ext else None,
                        size=stat.st_size,
                        mime_type=mime,
                        created_at=datetime.utcfromtimestamp(stat.st_birthtime)
                        if hasattr(stat, "st_birthtime")
                        else None,
                        modified_at=datetime.utcfromtimestamp(stat.st_mtime),
                    )
                    pending_files.append(db_file)

                    # Accumulate summary stats
                    progress.by_type[category] = progress.by_type.get(category, 0) + 1
                    progress.by_size[category] = (
                        progress.by_size.get(category, 0) + stat.st_size
                    )

                    # Flush batch
                    if len(pending_files) >= self.BATCH_SIZE:
                        self.db.add_all(pending_files)
                        await self.db.flush()
                        progress.files_indexed += len(pending_files)
                        pending_files.clear()

                        job.files_found = progress.files_found
                        job.files_indexed = progress.files_indexed
                        job.current_path = progress.current_path
                        await self.db.flush()

                        if progress_callback:
                            progress_callback(progress)

                        # Yield control to event loop
                        await asyncio.sleep(0)

            # Final flush
            if pending_files:
                self.db.add_all(pending_files)
                await self.db.flush()
                progress.files_indexed += len(pending_files)

            # Update device stats
            for device_id in device_ids:
                device = device_map.get(device_id)
                if device:
                    device.last_scanned = datetime.utcnow()
                    device.total_files = progress.files_indexed
                    device.total_size = sum(progress.by_size.values())

            progress.status = "done"
            job.status = "done"
            job.files_found = progress.files_found
            job.files_indexed = progress.files_indexed
            job.completed_at = datetime.utcnow()

        except Exception as exc:
            progress.status = "failed"
            progress.error = str(exc)
            job.status = "failed"
            job.error_message = str(exc)

        await self.db.flush()
        if progress_callback:
            progress_callback(progress)

        return progress
