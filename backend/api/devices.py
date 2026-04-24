"""
Device management API endpoints.

GET    /api/devices              → list all devices
POST   /api/devices/connect      → register a new device
GET    /api/devices/{id}         → get device detail
PATCH  /api/devices/{id}         → update device metadata
DELETE /api/devices/{id}         → disconnect/remove a device
GET    /api/devices/local/volumes → auto-detect local + external volumes (macOS)
POST   /api/devices/{id}/refresh  → refresh device stats from DB
"""

import json
import os
import platform
from pathlib import Path
from typing import Annotated, Optional

import psutil
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db.database import get_db
from backend.db.models import Device

router = APIRouter(prefix="/api/devices", tags=["devices"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class DeviceConnectionInfo(BaseModel):
    """Flexible connection info — fields depend on device type."""
    path: Optional[str] = None          # local path / mount point
    ip: Optional[str] = None            # SFTP / ADB WiFi
    port: Optional[int] = None
    username: Optional[str] = None
    ssh_key_path: Optional[str] = None
    password: Optional[str] = None      # stored in plain text only during setup; clear after
    adb_serial: Optional[str] = None    # Android ADB serial
    ios_udid: Optional[str] = None      # iOS UDID


class ConnectDeviceRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    type: str = Field(
        ..., pattern="^(mac|iphone|android|external|remote)$"
    )
    connection_info: DeviceConnectionInfo


class DeviceResponse(BaseModel):
    id: int
    name: str
    type: str
    connection_info: Optional[dict] = None
    last_scanned: Optional[str] = None
    total_files: int
    total_size: int
    is_connected: bool
    created_at: str

    @classmethod
    def from_orm(cls, device: Device) -> "DeviceResponse":
        conn = json.loads(device.connection_info) if device.connection_info else None
        # Scrub sensitive fields before returning
        if conn and "password" in conn:
            conn["password"] = "***"
        if conn and "ssh_key_path" in conn:
            conn["ssh_key_path"] = "***"
        return cls(
            id=device.id,
            name=device.name,
            type=device.type,
            connection_info=conn,
            last_scanned=device.last_scanned.isoformat() if device.last_scanned else None,
            total_files=device.total_files,
            total_size=device.total_size,
            is_connected=device.is_connected,
            created_at=device.created_at.isoformat(),
        )


class VolumeInfo(BaseModel):
    name: str
    path: str
    total_bytes: int
    used_bytes: int
    free_bytes: int
    fstype: str
    device_type: str  # mac | external


# ── Helpers ───────────────────────────────────────────────────────────────────

def _detect_local_volumes() -> list[VolumeInfo]:
    """
    Detect local disk volumes available on the current machine.
    On macOS: system disk + /Volumes/* mounts.
    On other platforms: falls back to psutil partition list.
    """
    volumes: list[VolumeInfo] = []
    system = platform.system()

    partitions = psutil.disk_partitions(all=False)
    for part in partitions:
        # Skip pseudo-filesystems
        if part.fstype in ("devfs", "autofs", "proc", "sysfs", "tmpfs", "devtmpfs"):
            continue
        if not part.mountpoint:
            continue

        try:
            usage = psutil.disk_usage(part.mountpoint)
        except PermissionError:
            continue

        # Classify: if it's under /Volumes and not the root disk → external
        mount = part.mountpoint
        if system == "Darwin":
            is_external = mount.startswith("/Volumes/") and mount != "/Volumes/Macintosh HD"
        else:
            is_external = mount not in ("/", "/home")

        volumes.append(
            VolumeInfo(
                name=Path(mount).name or mount,
                path=mount,
                total_bytes=usage.total,
                used_bytes=usage.used,
                free_bytes=usage.free,
                fstype=part.fstype,
                device_type="external" if is_external else "mac",
            )
        )

    return volumes


async def _verify_connection(device: Device) -> bool:
    """
    Lightweight liveness check for a device.
    For local/external: checks if the path is accessible.
    For remote/iOS/Android: returns True optimistically (full check at scan time).
    """
    if device.type in ("mac", "external"):
        conn = json.loads(device.connection_info) if device.connection_info else {}
        path = conn.get("path", "")
        return bool(path) and Path(path).exists()
    # iOS / Android / remote: assume connected if registered
    return True


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("", response_model=list[DeviceResponse])
async def list_devices(db: Annotated[AsyncSession, Depends(get_db)]):
    result = await db.execute(select(Device).order_by(Device.created_at))
    devices = result.scalars().all()

    # Refresh connection status on each list
    for device in devices:
        device.is_connected = await _verify_connection(device)

    await db.flush()
    return [DeviceResponse.from_orm(d) for d in devices]


@router.get("/local/volumes", response_model=list[VolumeInfo])
async def list_local_volumes():
    """Auto-detect all mounted local and external volumes."""
    return _detect_local_volumes()


@router.post("/connect", response_model=DeviceResponse, status_code=201)
async def connect_device(
    body: ConnectDeviceRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """
    Register a new device.
    For local/external devices, validates the path exists before saving.
    """
    conn_dict = body.connection_info.model_dump(exclude_none=True)

    # Validate local paths immediately
    if body.type in ("mac", "external"):
        path = conn_dict.get("path")
        if not path:
            raise HTTPException(status_code=400, detail="path is required for mac/external devices")
        if not Path(path).exists():
            raise HTTPException(status_code=400, detail=f"Path does not exist: {path}")

    device = Device(
        name=body.name,
        type=body.type,
        connection_info=json.dumps(conn_dict),
        is_connected=True,
    )
    db.add(device)
    await db.flush()
    return DeviceResponse.from_orm(device)


@router.get("/{device_id}", response_model=DeviceResponse)
async def get_device(
    device_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if device is None:
        raise HTTPException(status_code=404, detail="Device not found")
    device.is_connected = await _verify_connection(device)
    await db.flush()
    return DeviceResponse.from_orm(device)


@router.patch("/{device_id}", response_model=DeviceResponse)
async def update_device(
    device_id: int,
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Update device name or connection_info."""
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if device is None:
        raise HTTPException(status_code=404, detail="Device not found")

    if "name" in body:
        device.name = str(body["name"])[:255]
    if "connection_info" in body and isinstance(body["connection_info"], dict):
        device.connection_info = json.dumps(body["connection_info"])

    await db.flush()
    return DeviceResponse.from_orm(device)


@router.delete("/{device_id}", status_code=204)
async def disconnect_device(
    device_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """
    Mark a device as disconnected and remove its record.
    File index entries are preserved (is_deleted remains False).
    """
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if device is None:
        raise HTTPException(status_code=404, detail="Device not found")

    await db.delete(device)
    await db.flush()


@router.post("/{device_id}/refresh", response_model=DeviceResponse)
async def refresh_device_stats(
    device_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Recompute total_files and total_size from the current DB index."""
    from sqlalchemy import func as sa_func
    from backend.db.models import File

    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if device is None:
        raise HTTPException(status_code=404, detail="Device not found")

    agg = await db.execute(
        select(sa_func.count(File.id), sa_func.sum(File.size)).where(
            File.device_id == device_id, File.is_deleted == False  # noqa: E712
        )
    )
    count, total_size = agg.one()
    device.total_files = count or 0
    device.total_size = total_size or 0
    device.is_connected = await _verify_connection(device)

    await db.flush()
    return DeviceResponse.from_orm(device)
