# Mechanization (منظومة المكننة البلدية الذكية)

A high-performance, multi-tenant digital municipal platform tailored for Lebanese municipalities to automate cadastral mapping (GIS), citizen registry, property & building unit tracking, municipal fee collection (رسوم القيمة التأجيرية وبدل النفايات), in-person cash settlements, digital payments via Whish Money, and formal Arabic receipt generation.

---

## 🏛️ Product Truth & Scope

### 1. Municipal Stakeholders
- **Municipal Citizens (المواطنون والمكلفون)**:
  - Check outstanding taxes, fees, and waste management charges without visiting municipal halls.
  - View registered properties, apartments, commercial shops, and land parcels.
  - Settle payments digitally (via Whish Money or authorized collectors) and receive instant official receipts.
- **Municipal Clerks & Field Collectors (الجباة وموظفو الاستقبال والتحصيل)**:
  - Record in-person cash counter payments (full or partial).
  - Issue official municipal cash receipts matching Lebanon's printed receipt books (`وصل جباية رسمي`).
  - Share receipts directly to citizen WhatsApp accounts via native OS share sheet or PDF download.
- **Municipal Admins & Council Leadership (رئيس وأعضاء المجلس البلدي والمشرفون)**:
  - Real-time revenue analytics, collection velocity, overdue arrears, and resident demographics.
  - Cadastral map explorer with boundary tracking, parcel numbering, and sector zoning.
  - CSV reporting with injection-safe data export.
  - Full audit logging of staff actions.

---

## ⚙️ Core Technical Constraints & Architecture
- **Multi-Tenancy**: Schema-per-tenant (`tenant_<slug>`) in PostgreSQL with dynamic context resolution.
- **Language & Direction**: RTL first (Arabic `dir="rtl"`), with secondary LTR for numbers, codes, and English.
- **Currency**: Lebanese Pound (`LBP` / `ل.ل`) with compact formatting for billions/millions, and optional US Dollar (`USD` / `$`).
- **Security**: JWT authentication, granular RBAC (`SUPER_ADMIN`, `ADMIN`, `COLLECTOR`, `CITIZEN`), and complete audit event recording.
