"""
NeatDrive FastAPI application entry point.
Starts the async SQLite database, registers all API routers,
and serves the WebSocket + REST endpoints on localhost.
"""

import logging
import os
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.api.devices import router as devices_router
from backend.api.scan import router as scan_router
from backend.db.database import init_db

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("neatdrive")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize the database on startup."""
    logger.info("Initializing NeatDrive database …")
    await init_db()
    logger.info("Database ready. NeatDrive backend is up.")
    yield
    logger.info("NeatDrive backend shutting down.")


app = FastAPI(
    title="NeatDrive API",
    description="Cross-device digital document management and declutter backend",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS — allow Electron renderer (file:// origin) and local Vite dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",   # Vite dev server
        "http://localhost:3000",
        "app://.",                 # Electron production
        "file://",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(devices_router)
app.include_router(scan_router)


@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "neatdrive-backend"}


@app.get("/api/stats")
async def global_stats():
    """Quick summary stats for the Dashboard screen."""
    from sqlalchemy import func as sa_func, select

    from backend.db.database import AsyncSessionLocal
    from backend.db.models import Device, DuplicateGroup, File

    async with AsyncSessionLocal() as db:
        total_files = (
            await db.execute(
                select(sa_func.count(File.id)).where(File.is_deleted == False)  # noqa: E712
            )
        ).scalar() or 0

        total_size = (
            await db.execute(
                select(sa_func.sum(File.size)).where(File.is_deleted == False)  # noqa: E712
            )
        ).scalar() or 0

        duplicate_groups = (
            await db.execute(
                select(sa_func.count(DuplicateGroup.id)).where(
                    DuplicateGroup.resolved == False  # noqa: E712
                )
            )
        ).scalar() or 0

        connected_devices = (
            await db.execute(
                select(sa_func.count(Device.id)).where(Device.is_connected == True)  # noqa: E712
            )
        ).scalar() or 0

        # Space recoverable = sum of sizes of non-kept duplicate members
        from backend.db.models import DuplicateMember

        recoverable = (
            await db.execute(
                select(sa_func.sum(File.size))
                .join(DuplicateMember, DuplicateMember.file_id == File.id)
                .join(DuplicateGroup, DuplicateGroup.id == DuplicateMember.group_id)
                .where(
                    DuplicateGroup.resolved == False,  # noqa: E712
                    File.is_deleted == False,  # noqa: E712
                )
            )
        ).scalar() or 0

    return {
        "total_files": total_files,
        "total_size_bytes": total_size,
        "duplicate_groups": duplicate_groups,
        "space_recoverable_bytes": recoverable // 2,  # rough: keep one of each pair
        "connected_devices": connected_devices,
    }


if __name__ == "__main__":
    host = os.environ.get("NEATDRIVE_HOST", "127.0.0.1")
    port = int(os.environ.get("NEATDRIVE_PORT", "8000"))
    reload = os.environ.get("NEATDRIVE_RELOAD", "false").lower() == "true"

    uvicorn.run(
        "backend.main:app",
        host=host,
        port=port,
        reload=reload,
        log_level="info",
    )
