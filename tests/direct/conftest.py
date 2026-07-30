import sys
import os

import pytest

_real_unlink = os.unlink


def _windows_safe_unlink(path, *args, **kwargs):
    try:
        return _real_unlink(path, *args, **kwargs)
    except PermissionError:
        return None


os.unlink = _windows_safe_unlink


def warp_to(direct_vm, iso: str) -> None:
    """Move the simulated clock to `iso` (an ISO-8601 'Z' timestamp) and make
    sure gl.message_raw["datetime"] (and the nested gl.message.raw mirror)
    reflect it too, since the contract reads the Z-suffixed raw value rather
    than a parsed datetime object."""
    direct_vm.warp(iso)
    gl = sys.modules.get("genlayer.gl")
    if gl is None:
        return
    raw = getattr(gl, "message_raw", None)
    if isinstance(raw, dict):
        raw["datetime"] = iso
    nested = getattr(getattr(gl, "message", None), "raw", None)
    if isinstance(nested, dict):
        nested["datetime"] = iso


@pytest.fixture
def contract(direct_deploy):
    return direct_deploy("contracts/Rainline.py")
