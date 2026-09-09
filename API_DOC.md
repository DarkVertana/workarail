# Work à Rail REST API Documentation

This document describes all available REST API endpoints for the ZedgePanel (workarail) application, including authentication requirements, request parameters, bodies, success responses, and error response conditions.

---

## Authentication & Gating

All endpoints except authentication callbacks require a valid session. Session validation is handled using `better-auth`.
- **401 Unauthorized**: Returned if no valid session cookie is provided.
- **403 Forbidden**: Returned if a user attempts to access an endpoint outside of their role.
  - Crew members (users with an active `Staff` record) can access `/api/crew/*`.
  - Administrators (users without a `Staff` record) can access `/api/admin/*`.

---

## Crew Endpoints

### 1. GET `/api/crew/dashboard`
Returns the dashboard data for the authenticated crew member.

* **Method**: `GET`
* **Success Response**: `200 OK`
  * **Body**:
    ```json
    {
      "me": {
        "ref": "ST-01",
        "name": "Jane Doe",
        "role": "Conductor",
        "email": "jane@tvita.in"
      },
      "today": "2026-08-28",
      "attendanceWeek": ["2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30"],
      "codes": ["P", "P", "P", "P", "P", "-", "-"],
      "hours": 40,
      "taken": 5,
      "remaining": 23,
      "totalLeaveDays": 28,
      "openClaimsCount": 1,
      "latestPayPence": 250000,
      "payPeriodLabel": "August 2026",
      "myLeaveRequests": [],
      "myExpenses": [],
      "staffListForCelebrations": []
    }
    ```

---

### 2. GET `/api/crew/timesheet`
Retrieves the timesheet details for the active week for the authenticated crew member.

* **Method**: `GET`
* **Success Response**: `200 OK`
  * **Body**:
    ```json
    {
      "today": "2026-08-28",
      "attendanceWeek": ["2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30"],
      "codes": ["P", "P", "P", "P", "P", "-", "-"],
      "hours": 40
    }
    ```

---

### 3. POST `/api/crew/timesheet`
Submits or updates the timesheet codes for the current week.

* **Method**: `POST`
* **Request Body**:
  ```json
  {
    "codes": ["P", "P", "P", "P", "P", "-", "-"]
  }
  ```
* **Success Response**: `200 OK`
  * **Body**:
    ```json
    {
      "success": true
    }
    ```
* **Failure Responses**:
  * `400 Bad Request`: `{ "error": "Invalid request body: 'codes' must be an array" }`

---

### 4. POST `/api/crew/leave`
Submits a new annual, sick, or other leave request.

* **Method**: `POST`
* **Request Body**:
  ```json
  {
    "type": "annual",
    "from": "2026-09-01",
    "to": "2026-09-05",
    "reason": "Family vacation"
  }
  ```
* **Success Response**: `200 OK`
  * **Body**:
    ```json
    {
      "id": "LR-XYZ789",
      "staffRef": "ST-01",
      "type": "annual",
      "from": "2026-09-01T00:00:00.000Z",
      "to": "2026-09-05T00:00:00.000Z",
      "days": 5,
      "reason": "Family vacation",
      "status": "pending",
      "submitted": "2026-08-28T14:00:00.000Z"
    }
    ```
* **Failure Responses**:
  * `400 Bad Request`: `{ "error": "Missing or invalid fields in request body" }`

---

### 5. POST `/api/crew/expenses`
Submits a new expense reimbursement claim, with optional receipt attachment details.

* **Method**: `POST`
* **Request Body**:
  ```json
  {
    "date": "2026-08-25",
    "category": "travel",
    "merchant": "Trainline",
    "description": "Train ticket to depot",
    "amountPence": 4500,
    "method": "personal-card",
    "receipt": {
      "name": "receipt.pdf",
      "kind": "pdf",
      "size": "104 KB",
      "url": "https://storage.workarail.local/receipt.pdf"
    }
  }
  ```
* **Success Response**: `200 OK`
  * **Body**:
    ```json
    {
      "id": "EX-ABC123",
      "date": "2026-08-25T00:00:00.000Z",
      "category": "travel",
      "merchant": "Trainline",
      "description": "Train ticket to depot",
      "amountPence": 4500,
      "staffRef": "ST-01",
      "method": "personal-card",
      "status": "submitted",
      "receiptId": "receipt-attachment-id"
    }
    ```
* **Failure Responses**:
  * `400 Bad Request`: `{ "error": "Missing or invalid fields in request body" }`

---

### 6. GET `/api/crew/payslips`
Retrieves all historical payslip records for the authenticated crew member.

* **Method**: `GET`
* **Success Response**: `200 OK`
  * **Body**:
    ```json
    [
      {
        "id": "PR-01",
        "staffRef": "ST-01",
        "month": 8,
        "year": 2026,
        "grossPence": 300000,
        "taxPence": 35000,
        "niPence": 10000,
        "pensionPence": 5000,
        "netPence": 250000,
        "paidOn": "2026-08-28T00:00:00.000Z",
        "reference": "AUG26-ST01"
      }
    ]
    ```

---

## Admin Endpoints

### 1. GET `/api/admin/stats`
Retrieves aggregated admin dashboard stats.

* **Method**: `GET`
* **Success Response**: `200 OK`
  * **Body**:
    ```json
    [
      {
        "label": "Headcount",
        "value": "12",
        "delta": "+1",
        "trend": "up",
        "positive": true,
        "hint": "vs last month"
      },
      {
        "label": "In today",
        "value": "10",
        "delta": "0",
        "trend": "flat",
        "positive": true,
        "hint": "people away"
      }
    ]
    ```

---

### 2. GET `/api/admin/staff`
Retrieves the list of all staff members.

* **Method**: `GET`
* **Success Response**: `200 OK`
  * **Body**:
    ```json
    [
      {
        "ref": "ST-01",
        "name": "Jane Doe",
        "email": "jane@tvita.in",
        "phone": "+447700900077",
        "role": "Conductor",
        "crewId": "CR-01",
        "status": "active",
        "joined": "2025-01-15T00:00:00.000Z",
        "birthday": "1990-05-12"
      }
    ]
    ```

---

### 3. POST `/api/admin/staff`
Creates a new staff member and automatically triggers account creation and password invitation emails.

* **Method**: `POST`
* **Request Body**:
  ```json
  {
    "ref": "ST-02",
    "name": "John Smith",
    "email": "john.smith@tvita.in",
    "phone": "+447700900088",
    "role": "Driver",
    "crewId": "CR-01",
    "status": "active",
    "joined": "2026-08-28",
    "birthday": "1988-11-22"
  }
  ```
* **Success Response**: `200 OK`
  * **Body**:
    ```json
    {
      "ref": "ST-02",
      "name": "John Smith",
      "email": "john.smith@tvita.in",
      "phone": "+447700900088",
      "role": "Driver",
      "crewId": "CR-01",
      "status": "active",
      "joined": "2026-08-28T00:00:00.000Z",
      "birthday": "1988-11-22"
    }
    ```
* **Failure Responses**:
  * `400 Bad Request`: `{ "error": "Missing required fields in request body" }`

---

### 4. GET `/api/admin/crews`
Retrieves all crew groups.

* **Method**: `GET`
* **Success Response**: `200 OK`
  * **Body**:
    ```json
    [
      {
        "id": "CR-01",
        "name": "London Depot Crew"
      }
    ]
    ```

---

### 5. POST `/api/admin/crews`
Adds a new crew group.

* **Method**: `POST`
* **Request Body**:
  ```json
  {
    "name": "Manchester Depot Crew"
  }
  ```
* **Success Response**: `200 OK`
  * **Body**:
    ```json
    {
      "id": "CR-02",
      "name": "Manchester Depot Crew"
    }
    ```
* **Failure Responses**:
  * `400 Bad Request`: `{ "error": "Missing 'name' field in request body" }`

---

### 6. GET `/api/admin/invoices`
Retrieves all customer invoices.

* **Method**: `GET`
* **Success Response**: `200 OK`
  * **Body**:
    ```json
    [
      {
        "id": "INV-A1B2C",
        "clientId": "client-id-uuid",
        "reference": "INV-2026-001",
        "amountPence": 125000,
        "issued": "2026-08-28T00:00:00.000Z",
        "due": "2026-09-28T00:00:00.000Z",
        "status": "pending"
      }
    ]
    ```

---

### 7. POST `/api/admin/invoices`
Creates a new customer invoice (auto-creating the client if the name does not exist).

* **Method**: `POST`
* **Request Body**:
  ```json
  {
    "clientName": "Network Rail",
    "reference": "INV-2026-002",
    "amountPence": 340000,
    "issued": "2026-08-28",
    "due": "2026-09-28",
    "status": "pending"
  }
  ```
* **Success Response**: `200 OK`
  * **Body**:
    ```json
    {
      "id": "INV-F3G4H",
      "clientId": "new-client-id",
      "reference": "INV-2026-002",
      "amountPence": 340000,
      "issued": "2026-08-28T00:00:00.000Z",
      "due": "2026-09-28T00:00:00.000Z",
      "status": "pending"
    }
    ```
* **Failure Responses**:
  * `400 Bad Request`: `{ "error": "Missing or invalid required fields in request body" }`

---

### 8. GET `/api/admin/expenses`
Retrieves all expense claims submitted by staff.

* **Method**: `GET`
* **Success Response**: `200 OK`
  * **Body**:
    ```json
    [
      {
        "id": "EX-1",
        "date": "2026-08-25T00:00:00.000Z",
        "category": "fuel",
        "merchant": "Shell",
        "description": "Gasoline for company car",
        "amountPence": 6000,
        "staffRef": "ST-01",
        "method": "company-card",
        "status": "approved",
        "receiptId": null
      }
    ]
    ```

---

### 9. GET `/api/admin/leaves`
Retrieves all annual, sick, or other leave requests.

* **Method**: `GET`
* **Success Response**: `200 OK`
  * **Body**:
    ```json
    [
      {
        "id": "LR-1",
        "staffRef": "ST-01",
        "type": "annual",
        "from": "2026-09-01T00:00:00.000Z",
        "to": "2026-09-05T00:00:00.000Z",
        "days": 5,
        "reason": "Holiday",
        "status": "approved",
        "submitted": "2026-08-20T12:00:00.000Z"
      }
    ]
    ```

---

### 10. GET `/api/admin/payroll`
Retrieves all historical payroll run records.

* **Method**: `GET`
* **Success Response**: `200 OK`
  * **Body**:
    ```json
    [
      {
        "id": "PR-1",
        "staffRef": "ST-01",
        "month": 8,
        "year": 2026,
        "grossPence": 350000,
        "taxPence": 42000,
        "niPence": 12000,
        "pensionPence": 6000,
        "netPence": 290000,
        "paidOn": null,
        "reference": "AUG26-ST01"
      }
    ]
    ```

---

### 11. GET `/api/admin/settings`
Retrieves current application-wide configurations including SMTP settings.

* **Method**: `GET`
* **Success Response**: `200 OK`
  * **Body**:
    ```json
    {
      "companyName": "Work à Rail Ltd",
      "leaveDays": 28,
      "smtpHost": "smtp.mailtrap.io",
      "smtpPort": 587,
      "smtpSecure": false,
      "smtpUser": "user-smtp",
      "smtpPass": "pass-smtp",
      "smtpFrom": "noreply@workarail.com"
    }
    ```

---

### 12. POST `/api/admin/settings`
Updates current application-wide settings and SMTP configuration.

* **Method**: `POST`
* **Request Body**:
  ```json
  {
    "companyName": "Work à Rail Ltd",
    "leaveDays": 30,
    "smtpHost": "smtp.mailtrap.io",
    "smtpPort": 587,
    "smtpSecure": false,
    "smtpUser": "user-smtp",
    "smtpPass": "new-pass-smtp",
    "smtpFrom": "noreply@workarail.com"
  }
  ```
* **Success Response**: `200 OK`
  * **Body**:
    ```json
    {
      "success": true,
      "settings": {
        "companyName": "Work à Rail Ltd",
        "leaveDays": 30
      }
    }
    ```
