"""Pydantic request models for the CashPulse API (pydantic v2)."""

import re
from datetime import date
from typing import Any, Dict, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

ISO_DATE_PATTERN = r"^\d{4}-\d{2}-\d{2}$"

RelationshipTier = Literal["VIP_LOYAL", "REGULAR", "NEW", "CHRONIC_LATE"]
BillCategory = Literal["RENT", "SALARY", "UTILITY", "SUPPLIER", "EMI", "SHOCK"]
Channel = Literal["WHATSAPP", "SMS", "EMAIL"]
Tone = Literal["GENTLE", "WARM", "FIRM"]
MessageStatus = Literal["QUEUED", "SENT", "DELIVERED", "FAILED"]


def _require_real_date(value: Optional[str]) -> Optional[str]:
    """Pattern check already ran; this rejects impossible dates such as 2025-02-30."""
    if value is None:
        return value
    if not re.fullmatch(ISO_DATE_PATTERN, value):
        raise ValueError("must be a date in YYYY-MM-DD format")
    date.fromisoformat(value)
    return value


class SignupIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    name: str = Field(min_length=1)
    clinic_name: str = Field(min_length=1, alias="clinicName")
    email: str = Field(min_length=3)
    password: str = Field(min_length=6)


class LoginIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    email: str = Field(min_length=3)
    # No minimum here: a login should never reveal the signup password rule.
    password: str = Field(min_length=1)


class CustomerIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    name: str = Field(min_length=1)
    phone: str = Field(min_length=10)
    email: Optional[str] = None
    relationship_tier: RelationshipTier = Field(default="NEW", alias="relationshipTier")
    notes: Optional[str] = None


class CustomerPatch(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    name: Optional[str] = Field(default=None, min_length=1)
    phone: Optional[str] = Field(default=None, min_length=10)
    email: Optional[str] = None
    relationship_tier: Optional[RelationshipTier] = Field(default=None, alias="relationshipTier")
    notes: Optional[str] = None


class InvoiceIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    customer_id: str = Field(min_length=1, alias="customerId")
    amount: float = Field(gt=0, allow_inf_nan=False)
    due_date: str = Field(pattern=ISO_DATE_PATTERN, alias="dueDate")
    service_description: str = Field(default="", alias="serviceDescription")
    issue_date: Optional[str] = Field(default=None, pattern=ISO_DATE_PATTERN, alias="issueDate")

    @field_validator("due_date", "issue_date")
    @classmethod
    def check_dates(cls, value: Optional[str]) -> Optional[str]:
        return _require_real_date(value)


class InvoicePatch(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    amount: Optional[float] = Field(default=None, gt=0, allow_inf_nan=False)
    due_date: Optional[str] = Field(default=None, pattern=ISO_DATE_PATTERN, alias="dueDate")
    issue_date: Optional[str] = Field(default=None, pattern=ISO_DATE_PATTERN, alias="issueDate")
    service_description: Optional[str] = Field(default=None, alias="serviceDescription")

    @field_validator("due_date", "issue_date")
    @classmethod
    def check_dates(cls, value: Optional[str]) -> Optional[str]:
        return _require_real_date(value)


class PaymentIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    amount: float = Field(gt=0, allow_inf_nan=False)
    paid_on: Optional[str] = Field(default=None, pattern=ISO_DATE_PATTERN, alias="paidOn")

    @field_validator("paid_on")
    @classmethod
    def check_dates(cls, value: Optional[str]) -> Optional[str]:
        return _require_real_date(value)


class BillIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    title: str = Field(min_length=1)
    category: BillCategory
    amount: float = Field(gt=0, allow_inf_nan=False)
    due_date: str = Field(pattern=ISO_DATE_PATTERN, alias="dueDate")
    is_recurring_monthly: bool = Field(default=False, alias="isRecurringMonthly")
    is_deferrable: bool = Field(default=False, alias="isDeferrable")

    @field_validator("due_date")
    @classmethod
    def check_dates(cls, value: Optional[str]) -> Optional[str]:
        return _require_real_date(value)


class BillPatch(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    title: Optional[str] = Field(default=None, min_length=1)
    category: Optional[BillCategory] = None
    amount: Optional[float] = Field(default=None, gt=0, allow_inf_nan=False)
    due_date: Optional[str] = Field(default=None, pattern=ISO_DATE_PATTERN, alias="dueDate")
    is_recurring_monthly: Optional[bool] = Field(default=None, alias="isRecurringMonthly")
    is_deferrable: Optional[bool] = Field(default=None, alias="isDeferrable")
    is_paid: Optional[bool] = Field(default=None, alias="isPaid")

    @field_validator("due_date")
    @classmethod
    def check_dates(cls, value: Optional[str]) -> Optional[str]:
        return _require_real_date(value)


class DeferIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    days: int = Field(default=7, ge=1, le=60)


class MessageIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    customer_id: str = Field(min_length=1, alias="customerId")
    invoice_id: Optional[str] = Field(default=None, alias="invoiceId")
    channel: Channel
    tone: Tone
    included_partial_option: bool = Field(default=False, alias="includedPartialOption")
    body: str = Field(min_length=1)


class MessageStatusIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    status: MessageStatus


class ScenarioIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    horizon_days: Literal[30, 60, 90] = Field(default=90, alias="horizonDays")
    invoice_delay_overrides: Dict[str, int] = Field(
        default_factory=dict, alias="invoiceDelayOverrides"
    )
    global_late_days_shift: int = Field(default=0, ge=0, le=30, alias="globalLateDaysShift")
    extra_expense_shock: Optional[Dict[str, Any]] = Field(default=None, alias="extraExpenseShock")
    include_moving_avg_risk: bool = Field(default=True, alias="includeMovingAvgRisk")


class BankBalanceIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    amount: float = Field(ge=0, allow_inf_nan=False)


class AIToolRunIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    args: Dict[str, Any] = Field(default_factory=dict)


class AIPermissionsIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    global_enabled: bool = Field(alias="globalEnabled")
    max_auto_approve_inr: float = Field(alias="maxAutoApproveAmountINR")
    tool_policies: Dict[str, Any] = Field(alias="toolPolicies")


class ChatMessage(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str


class AgentChatIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    message: str = Field(min_length=1)
    history: list[ChatMessage] = Field(default_factory=list)


