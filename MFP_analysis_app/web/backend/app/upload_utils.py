import hashlib
import os
import uuid
from pathlib import Path
from typing import Optional, Set

from fastapi import HTTPException, UploadFile


def limit_bytes(env_var: str, default_mb: float) -> int:
    """Size limit from an environment variable in MB (read per call so it can be changed)."""
    try:
        mb = float(os.environ.get(env_var, default_mb))
    except ValueError:
        mb = default_mb
    return int(mb * 1024 * 1024)


async def stream_upload_to_file(
    file: UploadFile,
    dest_dir: Path,
    *,
    allowed_extensions: Optional[Set[str]] = None,
    chunk_size: int = 1024 * 1024,
) -> tuple[Path, str]:
    """Stream an incoming upload directly to dest_dir in chunks, computing sha256 on the fly.

    This avoids buffering the entire file in RAM, protecting Railway containers from OOM
    when uploading large .mzML files or batch uploads.
    """
    dest_dir.mkdir(parents=True, exist_ok=True)
    hasher = hashlib.sha256()
    name = file.filename or "upload.bin"

    if allowed_extensions is not None:
        lower_name = name.lower()
        if not any(lower_name.endswith(ext.lower()) for ext in allowed_extensions):
            exts_str = ", ".join(sorted(allowed_extensions))
            raise HTTPException(status_code=400, detail=f"Invalid file extension. Expected one of: {exts_str}")

    temp_dest = dest_dir / f".tmp_{uuid.uuid4().hex}"
    max_bytes = limit_bytes("MFP_MAX_UPLOAD_MB", 2048)
    written = 0

    try:
        with open(temp_dest, "wb") as f:
            while True:
                chunk = await file.read(chunk_size)
                if not chunk:
                    break
                written += len(chunk)
                if written > max_bytes:
                    raise HTTPException(
                        status_code=413,
                        detail=f"File is larger than the {max_bytes / 1024 / 1024:g} MB upload limit.",
                    )
                hasher.update(chunk)
                f.write(chunk)
    except Exception as exc:
        if temp_dest.exists():
            temp_dest.unlink(missing_ok=True)
        if isinstance(exc, HTTPException):
            raise
        raise HTTPException(status_code=500, detail=f"Failed writing upload to disk: {exc}") from exc

    safe_name = Path(name).name or "upload"
    stem = Path(safe_name).stem or "upload"
    suffix = "".join(Path(safe_name).suffixes)
    digest = hasher.hexdigest()[:12]
    final_dest = dest_dir / f"{stem}.{digest}{suffix}"

    if temp_dest.exists():
        temp_dest.replace(final_dest)

    return final_dest, name
