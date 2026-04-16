"""Calculator implementations exposed to the browser runtime."""

from __future__ import annotations

from importlib import import_module


__all__ = ["CavityModeCalculator", "GaussianBeamCalculator"]

_MODULE_BY_NAME = {
    "CavityModeCalculator": ".cavity_mode",
    "GaussianBeamCalculator": ".gaussian_beam",
}


def __getattr__(name: str):
    try:
        module_name = _MODULE_BY_NAME[name]
    except KeyError as exc:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}") from exc
    module = import_module(module_name, __name__)
    return getattr(module, name)


def __dir__() -> list[str]:
    return sorted(__all__)
