"""분석 입력(필수 조건) 모델.

모든 금액 단위는 '만원'이다. (예: 15억 = 150000)
"""
from __future__ import annotations

import builtins

from dataclasses import dataclass, field, fields, is_dataclass
from typing import Any, Optional, get_type_hints

PURPOSES = ("거주", "투자", "거주+투자")
PROPERTY_TYPES = ("아파트", "단독주택", "빌라", "오피스텔")

# 정비사업 단계 (순서가 의미 있음)
RECON_STAGES = (
    "해당없음",
    "재건축진단",      # 구 안전진단
    "정비구역지정",
    "추진위원회승인",
    "조합설립인가",
    "사업시행인가",
    "관리처분인가",
    "이주철거",
    "착공",
    "준공",
)


@dataclass
class Region:
    sido: Optional[str] = None          # 시·도 (예: 서울, 경기)
    sigungu: Optional[str] = None       # 시·군·구 (예: 송파구, 성남시 분당구)
    dong: Optional[str] = None
    # None 이면 규정파일 기준으로 자동 판정
    regulated: Optional[bool] = None            # 조정대상지역/투기과열지구
    land_permit_zone: Optional[bool] = None     # 토지거래허가구역


@dataclass
class Location:
    subway_walk_min: Optional[int] = None       # 역까지 도보(분)
    job_commute_min: Optional[int] = None       # 주요 업무지구 통근(분)
    school_walk_min: Optional[int] = None       # 초등학교 도보(분)
    amenities: list = field(default_factory=list)   # 호재·편의 (대형마트, 공원, GTX 등)
    negatives: list = field(default_factory=list)   # 악재·혐오시설


@dataclass
class Property:
    type: Optional[str] = None          # 아파트/단독주택/빌라/오피스텔
    area_m2: Optional[float] = None     # 전용면적(㎡)
    built_year: Optional[int] = None
    households: Optional[int] = None    # 단지 세대수
    reconstruction_target: bool = False  # 재건축·재개발 대상 여부


@dataclass
class Price:
    asking: Optional[int] = None                    # 매매가(만원)
    recent_trades: list = field(default_factory=list)  # 동일 평형 최근 실거래가(만원)
    jeonse: Optional[int] = None                    # 전세 시세 또는 승계 전세보증금(만원)
    assume_tenant: bool = False                     # 세입자 승계(갭) 여부


@dataclass
class Buyer:
    cash: Optional[int] = None                  # 즉시 동원 가능한 자기자금(만원)
    owned_homes: Optional[int] = None           # 현재 세대 보유 주택 수
    annual_income: Optional[int] = None         # 세대 연소득(만원)
    existing_debt_annual_payment: int = 0       # 기존 대출 연간 원리금(만원)
    annual_savings: int = 0                     # 대출 상환 후 연간 순저축(만원) — 이주비·분담금 재원
    first_time_buyer: bool = False              # 생애최초
    will_sell_existing: bool = False            # 기존주택 처분 조건 이행 의사
    will_live_in: Optional[bool] = None         # 실거주 여부 (None 이면 목적에서 추정)


@dataclass
class Loan:
    rate: float = 4.0           # 대출 금리(%)
    years: int = 30
    use_loan: bool = True


@dataclass
class Reconstruction:
    stage: Optional[str] = None
    prior_asset_value: Optional[int] = None   # 종전자산 감정평가액(만원)
    expected_contribution: Optional[int] = None  # 예상 분담금(만원, 환급이면 음수)
    new_unit_value: Optional[int] = None      # 신축 예상 시세(만원)
    relocation_loan_ltv: Optional[float] = None  # 이주비 대출 LTV(%) - 미입력시 규정 기본값
    temp_housing_deposit: Optional[int] = None  # 공사기간 임시거주 전세보증금(만원)
    owner_held_years: Optional[int] = None    # 매도인 보유기간(지위양도 예외 판단)
    owner_lived_years: Optional[int] = None   # 매도인 거주기간


@dataclass
class Timing:
    purchase_date: Optional[str] = None     # "YYYY-MM"
    holding_years: Optional[int] = None     # 계획 보유기간
    move_in_by: Optional[str] = None        # 입주 희망 시점 "YYYY-MM"


@dataclass
class Conditions:
    purpose: Optional[str] = None
    region: Region = field(default_factory=Region)
    location: Location = field(default_factory=Location)
    property: Property = field(default_factory=Property)
    price: Price = field(default_factory=Price)
    buyer: Buyer = field(default_factory=Buyer)
    loan: Loan = field(default_factory=Loan)
    reconstruction: Reconstruction = field(default_factory=Reconstruction)
    timing: Timing = field(default_factory=Timing)

    @builtins.property
    def lives_in(self) -> bool:
        if self.buyer.will_live_in is not None:
            return self.buyer.will_live_in
        return self.purpose in ("거주", "거주+투자")

    @builtins.property
    def is_recon(self) -> bool:
        return self.property.reconstruction_target or (
            self.reconstruction.stage not in (None, "해당없음")
        )


def _build(cls, data: Any):
    if not isinstance(data, dict):
        return data
    hints = get_type_hints(cls)
    known = {f.name for f in fields(cls)}
    unknown = set(data) - known
    if unknown:
        raise ValueError(f"{cls.__name__}: 알 수 없는 항목 {sorted(unknown)}")
    kwargs = {}
    for name, value in data.items():
        t = hints[name]
        kwargs[name] = _build(t, value) if is_dataclass(t) else value
    return cls(**kwargs)


def from_dict(data: dict) -> Conditions:
    return _build(Conditions, data)
