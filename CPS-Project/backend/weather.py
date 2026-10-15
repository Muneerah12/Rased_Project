"""Provider-neutral contracts for external temperature integrations.

No provider, credentials, site, or network client is configured here. A later
adapter can implement this contract once deployment details are supplied.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol


@dataclass(frozen=True)
class TemperatureObservation:
    provider: str
    site_id: str
    observed_at: datetime | None
    retrieved_at: datetime
    value: float | None
    unit: str | None
    status: str
    error_code: str | None = None


class TemperatureProvider(Protocol):
    def fetch(self, site_id: str) -> TemperatureObservation:
        """Fetch one observation for a configured site."""
