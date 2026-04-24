"""
SQLAlchemy ORM models for NeatDrive.
All tables use integer primary keys with SQLite autoincrement.
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class Device(Base):
    __tablename__ = "devices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    type: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # mac | iphone | android | external | remote
    connection_info: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True
    )  # JSON: path, ip, port, etc.
    last_scanned: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    total_files: Mapped[int] = mapped_column(Integer, default=0)
    total_size: Mapped[int] = mapped_column(Integer, default=0)  # bytes
    is_connected: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=func.now(), nullable=False
    )

    files: Mapped[list["File"]] = relationship("File", back_populates="device")


class File(Base):
    __tablename__ = "files"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    device_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False
    )
    path: Mapped[str] = mapped_column(Text, nullable=False)  # full absolute path
    filename: Mapped[str] = mapped_column(String(512), nullable=False)
    extension: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    size: Mapped[int] = mapped_column(Integer, default=0)  # bytes
    mime_type: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    # Hashes
    sha256_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    phash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)  # perceptual hash hex

    # Timestamps
    created_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    modified_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    indexed_at: Mapped[datetime] = mapped_column(DateTime, default=func.now(), nullable=False)

    # AI rename
    ai_suggested_name: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    ai_confidence: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    ai_reasoning: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Metadata
    tags: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON array of strings
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    thumbnail_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    device: Mapped["Device"] = relationship("Device", back_populates="files")
    duplicate_memberships: Mapped[list["DuplicateMember"]] = relationship(
        "DuplicateMember", back_populates="file"
    )
    rename_history: Mapped[list["RenameHistory"]] = relationship(
        "RenameHistory", back_populates="file"
    )


class DuplicateGroup(Base):
    __tablename__ = "duplicate_groups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    detection_method: Mapped[str] = mapped_column(
        String(20), nullable=False
    )  # sha256 | phash | semantic
    similarity_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    resolved: Mapped[bool] = mapped_column(Boolean, default=False)
    resolution_action: Mapped[Optional[str]] = mapped_column(
        String(50), nullable=True
    )  # keep_left | keep_right | keep_both | delete_both
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now(), nullable=False)

    members: Mapped[list["DuplicateMember"]] = relationship(
        "DuplicateMember", back_populates="group"
    )


class DuplicateMember(Base):
    __tablename__ = "duplicate_members"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    group_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("duplicate_groups.id", ondelete="CASCADE"), nullable=False
    )
    file_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("files.id", ondelete="CASCADE"), nullable=False
    )
    kept: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)  # None = unresolved

    group: Mapped["DuplicateGroup"] = relationship("DuplicateGroup", back_populates="members")
    file: Mapped["File"] = relationship("File", back_populates="duplicate_memberships")


class TransferJob(Base):
    __tablename__ = "transfer_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source_file_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("files.id", ondelete="SET NULL"), nullable=True
    )
    dest_device_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False
    )
    dest_path: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(
        String(20), default="queued"
    )  # queued | running | paused | done | failed | cancelled
    bytes_transferred: Mapped[int] = mapped_column(Integer, default=0)
    total_bytes: Mapped[int] = mapped_column(Integer, default=0)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


class RenameHistory(Base):
    __tablename__ = "rename_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    file_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("files.id", ondelete="CASCADE"), nullable=False
    )
    old_name: Mapped[str] = mapped_column(String(512), nullable=False)
    new_name: Mapped[str] = mapped_column(String(512), nullable=False)
    renamed_at: Mapped[datetime] = mapped_column(DateTime, default=func.now(), nullable=False)
    source: Mapped[str] = mapped_column(String(20), default="manual")  # manual | ai

    file: Mapped["File"] = relationship("File", back_populates="rename_history")


class ScanJob(Base):
    __tablename__ = "scan_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    device_ids: Mapped[str] = mapped_column(Text, nullable=False)  # JSON array of device IDs
    file_types: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON array or null
    scan_depth: Mapped[str] = mapped_column(String(10), default="deep")  # shallow | deep
    exclusion_patterns: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON array
    status: Mapped[str] = mapped_column(
        String(20), default="pending"
    )  # pending | running | done | failed
    files_found: Mapped[int] = mapped_column(Integer, default=0)
    files_indexed: Mapped[int] = mapped_column(Integer, default=0)
    current_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now(), nullable=False)
