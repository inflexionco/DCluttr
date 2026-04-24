"""
SHA-256 hashing engine for NeatDrive Phase 1.
Computes file hashes with streaming to handle large files efficiently,
then groups duplicate files by identical hash value.
"""

import asyncio
import hashlib
from collections import defaultdict
from pathlib import Path
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db.models import DuplicateGroup, DuplicateMember, File

CHUNK_SIZE = 65536  # 64 KB read chunks for streaming hash


async def compute_sha256(path: str | Path) -> str:
    """
    Compute SHA-256 hash of a file using streaming reads.
    Runs blocking I/O in a thread pool to avoid blocking the event loop.
    """

    def _hash_file(file_path: Path) -> str:
        h = hashlib.sha256()
        with open(file_path, "rb") as f:
            while chunk := f.read(CHUNK_SIZE):
                h.update(chunk)
        return h.hexdigest()

    return await asyncio.to_thread(_hash_file, Path(path))


async def hash_file_record(file_id: int, db: AsyncSession) -> Optional[str]:
    """
    Load a File record, compute its SHA-256 hash, persist it, and return the hex digest.
    Returns None if the file doesn't exist or is inaccessible.
    """
    result = await db.execute(select(File).where(File.id == file_id))
    file = result.scalar_one_or_none()
    if file is None:
        return None

    file_path = Path(file.path)
    if not file_path.exists():
        return None

    try:
        digest = await compute_sha256(file_path)
        file.sha256_hash = digest
        await db.flush()
        return digest
    except (OSError, PermissionError):
        return None


async def hash_all_unhashed(
    device_id: int,
    db: AsyncSession,
    progress_callback=None,
) -> int:
    """
    Compute SHA-256 for all File records belonging to `device_id` that don't
    yet have a hash.  Returns the number of files hashed.
    """
    result = await db.execute(
        select(File).where(
            File.device_id == device_id,
            File.sha256_hash.is_(None),
            File.is_deleted == False,  # noqa: E712
        )
    )
    files: list[File] = list(result.scalars().all())
    hashed = 0

    for file in files:
        if not Path(file.path).exists():
            continue
        try:
            digest = await compute_sha256(file.path)
            file.sha256_hash = digest
            hashed += 1
            if progress_callback:
                progress_callback(hashed, len(files))
            # Yield every 50 files to keep event loop responsive
            if hashed % 50 == 0:
                await db.flush()
                await asyncio.sleep(0)
        except (OSError, PermissionError):
            continue

    await db.flush()
    return hashed


async def detect_exact_duplicates(
    device_ids: list[int],
    db: AsyncSession,
) -> list[DuplicateGroup]:
    """
    Group all files across the given device IDs by identical SHA-256 hash.
    Creates DuplicateGroup + DuplicateMember rows for each group with ≥ 2 members.
    Returns the list of newly created DuplicateGroup objects.
    """
    # Load all hashed files for these devices
    result = await db.execute(
        select(File).where(
            File.device_id.in_(device_ids),
            File.sha256_hash.isnot(None),
            File.is_deleted == False,  # noqa: E712
        )
    )
    files: list[File] = list(result.scalars().all())

    # Group by hash
    hash_to_files: dict[str, list[File]] = defaultdict(list)
    for f in files:
        if f.sha256_hash:
            hash_to_files[f.sha256_hash].append(f)

    created_groups: list[DuplicateGroup] = []

    for digest, dup_files in hash_to_files.items():
        if len(dup_files) < 2:
            continue

        # Check if a group already exists for this exact hash set
        existing = await _find_existing_group(digest, db)
        if existing:
            continue

        group = DuplicateGroup(
            detection_method="sha256",
            similarity_score=1.0,
        )
        db.add(group)
        await db.flush()  # get group.id

        for dup_file in dup_files:
            member = DuplicateMember(group_id=group.id, file_id=dup_file.id)
            db.add(member)

        await db.flush()
        created_groups.append(group)

    return created_groups


async def _find_existing_group(digest: str, db: AsyncSession) -> Optional[DuplicateGroup]:
    """
    Return an existing unresolved DuplicateGroup whose members all share the
    given SHA-256 digest, or None.
    This prevents re-creating duplicate groups on repeated runs.
    """
    # Find all file IDs with this hash
    result = await db.execute(
        select(File.id).where(File.sha256_hash == digest, File.is_deleted == False)  # noqa: E712
    )
    file_ids = set(row[0] for row in result.all())
    if len(file_ids) < 2:
        return None

    # Find groups whose members match this file ID set
    result = await db.execute(
        select(DuplicateMember.group_id)
        .where(DuplicateMember.file_id.in_(file_ids))
        .distinct()
    )
    candidate_group_ids = [row[0] for row in result.all()]

    for gid in candidate_group_ids:
        result = await db.execute(
            select(DuplicateGroup).where(
                DuplicateGroup.id == gid,
                DuplicateGroup.detection_method == "sha256",
                DuplicateGroup.resolved == False,  # noqa: E712
            )
        )
        group = result.scalar_one_or_none()
        if group:
            # Verify member count matches
            result = await db.execute(
                select(DuplicateMember).where(DuplicateMember.group_id == gid)
            )
            members = result.scalars().all()
            member_file_ids = {m.file_id for m in members}
            if member_file_ids == file_ids:
                return group

    return None
