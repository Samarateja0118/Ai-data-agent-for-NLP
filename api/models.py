from typing import Literal, Optional

from pydantic import BaseModel, Field

Operation = Literal[
    "overview",
    "list_columns",
    "row_count",
    "missing_values",
    "preview",
    "aggregate",
    "group_aggregate",
    "filter",
]

Aggregation = Literal["mean", "sum", "median", "min", "max", "count"]

FilterOperator = Literal[
    "equals",
    "not_equals",
    "greater_than",
    "less_than",
    "greater_or_equal",
    "less_or_equal",
    "contains",
]


class FilterCondition(BaseModel):
    column: str
    operator: FilterOperator
    value: str


class QueryPlan(BaseModel):
    operation: Operation
    column: Optional[str] = None
    columnTypeFilter: Optional[Literal["number", "string", "all"]] = None
    groupByColumn: Optional[str] = None
    aggregation: Optional[Aggregation] = None
    filters: list[FilterCondition] = Field(default_factory=list)
    limit: Optional[int] = None
    clarificationNeeded: bool = False
    clarificationMessage: Optional[str] = None


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class DatasetUploadRequest(BaseModel):
    name: str
    csvText: str


class DatasetUploadResponse(BaseModel):
    schema_: dict = Field(alias="schema")

    model_config = {"populate_by_name": True}


class QueryRequest(BaseModel):
    name: str
    csvText: str
    question: str
    history: list[ChatTurn] = Field(default_factory=list)


class ToolEvent(BaseModel):
    type: str
    label: str
    detail: str


class QueryFocus(BaseModel):
    chartColumn: Optional[str] = None
    categoryColumn: Optional[str] = None


class QueryResponse(BaseModel):
    response: str
    toolEvents: list[ToolEvent]
    focus: Optional[QueryFocus] = None
