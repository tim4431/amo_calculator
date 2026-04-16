"""Common utilities for browser-side calculator wrappers."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

import numpy as np


class CalculatorDefinition(ABC):
    """Base class for a browser-exposed calculator."""

    calculator_id: str
    title: str
    description: str
    layout: str

    def manifest(self) -> dict[str, Any]:
        return {
            "id": self.calculator_id,
            "title": self.title,
            "description": self.description,
            "layout": self.layout,
        }

    @abstractmethod
    def schema(self) -> dict[str, Any]:
        """Return UI schema and default state."""

    @abstractmethod
    def evaluate(self, state: dict[str, Any]) -> dict[str, Any]:
        """Execute the calculator and return JSON-serializable output."""


def to_serializable(value: Any) -> Any:
    """Recursively convert numpy values into JSON-safe Python objects."""
    if isinstance(value, dict):
        return {str(key): to_serializable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_serializable(item) for item in value]
    if isinstance(value, np.ndarray):
        return [to_serializable(item) for item in value.tolist()]
    if isinstance(value, (np.floating, np.integer)):
        return value.item()
    if isinstance(value, np.bool_):
        return bool(value.item())
    if isinstance(value, complex):
        return {
            "real": float(np.real(value)),
            "imag": float(np.imag(value)),
        }
    return value


__all__ = ["CalculatorDefinition", "to_serializable"]
