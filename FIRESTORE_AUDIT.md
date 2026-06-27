# Complete Firestore Data Operation Audit — Green Motion Web App

**Scope:** All `.js` files under `src/`  
**Date:** 2025-02-07

---

## 1. Collection reference inventory

Every `collection(db, '...')` reference with **exact collection name**:

| Collection name        | File(s) | Line(s) | Notes |
|-------------------------|---------|---------|--------|
| `users`                 | AdminFranchiseDashboard.js, AdminFranchiseDetailView.js, AdminUserManagementView.js, App.js; archived: `_deprecated/App_Updated.js` | 62, 43, 112, 1154–1155, 1581, 73 | System data |
| `franchises`            | AdminFranchiseDashboard.js, AdminFranchiseDetailView.js, AdminUserManagementView.js | 94, 462, 129 | System data |
| `vacationTimes`         | VacationTimesView.js | 38 | Business (per-franchise) |
| `araclar`               | App.js; archived: `_deprecated/App_with_ocr.js`, `_deprecated/App_Updated.js` | Many (see below) | Business |
| `servisler`             | App.js | 1001, 1168, 1378, 17341, 17641 | Business (App uses `servisler`; OCR/Updated use `servisKayitlari`) |
| `servisKayitlari`       | App.js; archived: `_deprecated/App_with_ocr.js`, `_deprecated/App_Updated.js` | 9321, 516, 595, 88, 151 | Business |
| `iadeIslemleri`         | App.js; archived: `_deprecated/App_with_ocr.js`, `_deprecated/App_Updated.js` | Many | Business |
| `exitIslemleri`         | App.js | 1011, 1169, 1388, 16952, 17479, 17517 | Business |
| `activities`            | App.js; archived: `_deprecated/App_with_ocr.js`, `_deprecated/App_Updated.js` | 1035, 1170, 1222, 1412, 1596, 16670, etc. | Business (audit log) |
| `office_operations`     | App.js; archived: `_deprecated/App_with_ocr.js`, `_deprecated/App_Updated.js` | Many | Business |
| `servisFirmalari`       | App.js; archived: `_deprecated/App_with_ocr.js`, `_deprecated/App_Updated.js` | Many | Business |
| `trafficFines`          | App.js | 1092, 4763, 5210, 5402 | Business |
| `bankingTransactions`   | App.js | 1096, 4884, 5613, 5784 | Business |
| `additionalSales`       | App.js | 1101, 1478 | Business (read-only in web) |
| `office_Return`         | App.js | 1124, 1501 | Business (read-only in web) |
| `shuttleEntries`        | App.js | 1129, 11766, 11939, 1506 | Business |
| `workSchedules`         | App.js | 1133, 1510 | Business (read-only in web) |
| `assistantCompanies`    | App.js | 1515, 18315, 18326, 18363 | Business |
| `semesInvoices`         | App.js | 12383, 14377, 14232 | Business |
| `protocolTemplates`     | App.js | 12423, 12621, 13347 | System/shared (templates) |
| `protocols`             | App.js | 12460, 13470, 13490, 13586, 14016, 15191 | Business |
| `transactions`          | `_deprecated/App_with_ocr.js`, `_deprecated/App_Updated.js` only (archived) | 544, 112 | ERP (business) |
| `customers`             | `_deprecated/App_with_ocr.js`, `_deprecated/App_Updated.js` only (archived) | 548, 116 | ERP (business) |
| `accidents`             | `_deprecated/App_with_ocr.js`, `_deprecated/App_Updated.js` only (archived) | 552, 120 | ERP (business) |
| `protocols` (ERP)       | `_deprecated/App_with_ocr.js`, `_deprecated/App_Updated.js` only (archived) | 556, 124 | ERP (business) |
| `accidentCodes`         | `_deprecated/App_with_ocr.js`, `_deprecated/App_Updated.js` only (archived); global catalog also used by iOS | 560, 128 | ERP / shared codes |

Dynamic `collection(db, colName)` / `col.name` in App.js: used in debug/admin tools and report flows (lines 14773, 14801, 15582, 15707, 15962, 15996, 16020, 16055, 16080, 16104, 16139, 16145, 16582, 16602, 16621, 16644) — colName/col.name can be any of the listed collections.

---

## 2. Operation-by-operation audit

### 2.1 App.js (main app — primary reference)

#### Reads (getDoc / getDocs)

| Line   | Operation   | Collection           | Filters by franchiseId? | Should be franchise-filtered? |
|--------|-------------|----------------------|--------------------------|--------------------------------|
| 1155   | getDoc      | users                | No                       | No (user doc by uid)          |
| 1167   | getDocs     | araclar              | No                       | **Yes**                       |
| 1168   | getDocs     | servisler            | No                       | **Yes**                       |
| 1169   | getDocs     | iadeIslemleri        | No                       | **Yes**                       |
| 1170   | getDocs     | activities (query)   | No                       | **Yes**                       |
| 1171   | getDocs     | office_operations    | No                       | **Yes**                       |
| 1172   | getDocs     | servisFirmalari      | No                       | **Yes**                       |
| 1581   | getDoc      | users                | No                       | No                            |
| 6475   | getDoc      | araclar              | No                       | N/A (by doc id)               |
| 7308   | getDoc      | araclar              | No                       | N/A                           |
| 7331   | getDoc      | araclar              | No                       | N/A                           |
| 7352   | getDoc      | araclar              | No                       | N/A                           |
| 8184   | getDoc      | araclar              | No                       | N/A                           |
| 11942  | getDoc      | shuttleEntries       | No                       | N/A                           |
| 12387  | getDocs     | semesInvoices (query)| No                       | **Yes**                       |
| 12391  | getDocs     | semesInvoices        | No                       | **Yes**                       |
| 12424  | getDocs     | protocolTemplates    | No                       | No (system templates)         |
| 12461  | getDocs     | protocols (query)    | No                       | **Yes**                       |
| 14773  | getDocs     | colName (dynamic)    | No                       | Depends on collection         |
| 14801  | getDocs     | colName (dynamic)    | No                       | Depends on collection         |
| 15582  | getDocs     | colName (dynamic)    | No                       | Depends on collection         |
| 15707  | getDocs     | colName (dynamic)    | No                       | Depends on collection         |
| 15962  | getDocs     | colName (dynamic)    | No                       | Depends on collection         |
| 15996  | getDocs     | colName (query)      | No                       | Depends on collection         |
| 16020  | getDocs     | colName (query)      | No                       | Depends on collection         |
| 16055  | getDocs     | colName              | No                       | Depends on collection         |
| 16104  | getDocs     | colName (query)      | No                       | Depends on collection         |
| 16139  | getDocs     | colName (query)      | No                       | Depends on collection         |
| 16581  | getDocs     | col.name (query)     | No                       | **Yes** for business cols     |
| 16601  | getDocs     | col.name (query)     | No                       | **Yes** for business cols     |
| 16621  | getDocs     | col.name (query)     | No                       | **Yes** for business cols     |
| 16643  | getDocs     | col.name (query)     | No                       | **Yes** for business cols     |
| 16669  | getDocs     | activities (where islem=='Silindi') | No | **Yes**                       |
| 16952  | getDocs     | exitIslemleri        | No                       | **Yes**                       |
| 17049  | getDocs     | iadeIslemleri        | No                       | **Yes**                       |
| 17116  | getDocs     | araclar              | No                       | **Yes**                       |
| 17193  | getDocs     | araclar              | No                       | **Yes**                       |
| 17261  | getDocs     | office_operations    | No                       | **Yes**                       |
| 17341  | getDocs     | servisler            | No                       | **Yes**                       |
| 17408  | getDocs     | servisFirmalari      | No                       | **Yes**                       |
| 17479  | getDocs     | exitIslemleri        | No                       | **Yes**                       |
| 17529  | getDocs     | araclar              | No                       | **Yes**                       |
| 17563  | getDocs     | iadeIslemleri        | No                       | **Yes**                       |
| 17596  | getDocs     | araclar              | No                       | **Yes**                       |
| 17616  | getDocs     | office_operations    | No                       | **Yes**                       |
| 17636  | getDocs     | servisler            | No                       | **Yes**                       |
| 17656  | getDocs     | servisFirmalari      | No                       | **Yes**                       |

#### Listens (onSnapshot)

| Line   | Collection           | Filters by franchiseId? | Should be franchise-filtered? |
|--------|----------------------|--------------------------|--------------------------------|
| 973    | araclar              | No                       | **Yes**                       |
| 1001   | servisler            | No                       | **Yes**                       |
| 1006   | iadeIslemleri        | No                       | **Yes**                       |
| 1011   | exitIslemleri        | No                       | **Yes**                       |
| 1034–1035 | activities (query) | No                       | **Yes**                       |
| 1042   | office_operations    | No                       | **Yes**                       |
| 1067–1068 | servisFirmalari    | No                       | **Yes**                       |
| 1092   | trafficFines         | No                       | **Yes**                       |
| 1096   | bankingTransactions  | No                       | **Yes**                       |
| 1101   | additionalSales      | No                       | **Yes**                       |
| 1124   | office_Return        | No                       | **Yes**                       |
| 1129   | shuttleEntries       | No                       | **Yes**                       |
| 1133   | workSchedules        | No                       | **Yes**                       |
| 1350   | araclar              | No                       | **Yes** (second setupRealTimeListeners) |
| 1378   | servisler            | No                       | **Yes**                       |
| 1383   | iadeIslemleri        | No                       | **Yes**                       |
| 1388   | exitIslemleri        | No                       | **Yes**                       |
| 1411–1412 | activities (query) | No                     | **Yes**                       |
| 1419   | office_operations    | No                       | **Yes**                       |
| 1444–1445 | servisFirmalari    | No                       | **Yes**                       |
| 1469   | trafficFines         | No                       | **Yes**                       |
| 1473   | bankingTransactions  | No                       | **Yes**                       |
| 1478   | additionalSales      | No                       | **Yes**                       |
| 1501   | office_Return        | No                       | **Yes**                       |
| 1506   | shuttleEntries       | No                       | **Yes**                       |
| 1510   | workSchedules        | No                       | **Yes**                       |
| 1515   | assistantCompanies   | No                       | **Yes**                       |

#### Writes (addDoc / setDoc / updateDoc / deleteDoc)

| Line   | Operation | Collection           | Filters by franchiseId? | Payload has franchiseId? | Should have franchiseId? |
|--------|-----------|----------------------|--------------------------|---------------------------|---------------------------|
| 1222   | addDoc    | activities           | N/A                      | **No**                    | **Yes**                  |
| 1596   | addDoc    | activities           | N/A                      | **No**                    | **Yes**                  |
| 5210   | addDoc    | trafficFines         | N/A                      | **No**                    | **Yes**                  |
| 5613   | addDoc    | bankingTransactions  | N/A                      | **No**                    | **Yes**                  |
| 6781   | setDoc    | araclar              | N/A                      | **No**                    | **Yes**                  |
| 8373   | setDoc    | iadeIslemleri        | N/A                      | **No**                    | **Yes**                  |
| 9321   | setDoc    | servisKayitlari      | N/A                      | **No**                    | **Yes**                  |
| 9701   | addDoc    | servisFirmalari      | N/A                      | **No**                    | **Yes**                  |
| 10832  | setDoc    | office_operations    | N/A                      | **No**                    | **Yes**                  |
| 11143  | setDoc    | office_operations    | N/A                      | **No**                    | **Yes**                  |
| 11766  | addDoc    | shuttleEntries       | N/A                      | **No**                    | **Yes**                  |
| 12621  | setDoc    | protocolTemplates    | N/A                      | No                        | No (system)               |
| 14377  | setDoc    | semesInvoices        | N/A                      | **No**                    | **Yes**                  |
| 15191  | setDoc    | protocols            | N/A                      | **No**                    | **Yes**                  |
| 18326  | setDoc    | assistantCompanies   | N/A                      | **No**                    | **Yes**                  |
| 4763   | deleteDoc | trafficFines         | N/A                      | —                         | N/A                       |
| 4884   | deleteDoc | bankingTransactions  | N/A                      | —                         | N/A                       |
| 5402   | updateDoc | trafficFines         | N/A                      | —                         | N/A                       |
| 5784   | updateDoc | bankingTransactions  | N/A                      | —                         | N/A                       |
| 6504   | updateDoc | araclar              | N/A                      | —                         | N/A                       |
| 7294   | deleteDoc | araclar              | N/A                      | —                         | N/A                       |
| 7315   | updateDoc | araclar              | N/A                      | —                         | N/A                       |
| 7338   | updateDoc | araclar              | N/A                      | —                         | N/A                       |
| 7362   | updateDoc | araclar              | N/A                      | —                         | N/A                       |
| 8194   | updateDoc | araclar              | N/A                      | —                         | N/A                       |
| 9649   | deleteDoc | servisFirmalari      | N/A                      | —                         | N/A                       |
| 9812   | updateDoc | servisFirmalari      | N/A                      | —                         | N/A                       |
| 10428  | deleteDoc | office_operations    | N/A                      | —                         | N/A                       |
| 11973  | updateDoc | shuttleEntries (ref) | N/A                      | —                         | N/A                       |
| 13347  | deleteDoc | protocolTemplates    | N/A                      | —                         | No (system)               |
| 13470  | deleteDoc | protocols            | N/A                      | —                         | N/A                       |
| 13490  | deleteDoc | protocols            | N/A                      | —                         | N/A                       |
| 13586  | updateDoc | protocols            | N/A                      | —                         | N/A                       |
| 14016  | updateDoc | protocols            | N/A                      | —                         | N/A                       |
| 14232  | deleteDoc | semesInvoices        | N/A                      | —                         | N/A                       |
| 17517  | updateDoc | exitIslemleri        | N/A                      | —                         | N/A                       |
| 17548  | updateDoc | araclar              | N/A                      | —                         | N/A                       |
| 17583  | updateDoc | iadeIslemleri        | N/A                      | —                         | N/A                       |
| 17601  | updateDoc | araclar              | N/A                      | —                         | N/A                       |
| 17621  | updateDoc | office_operations    | N/A                      | —                         | N/A                       |
| 17641  | updateDoc | servisler            | N/A                      | —                         | N/A                       |
| 17661  | updateDoc | servisFirmalari      | N/A                      | —                         | N/A                       |
| 18315  | updateDoc | assistantCompanies   | N/A                      | —                         | N/A                       |
| 18363  | deleteDoc | assistantCompanies   | N/A                      | —                         | N/A                       |

Debug/test flows (addDoc/updateDoc/deleteDoc with `colName`): 16080, 16083, 16108–16109, 16143, 16145 — should respect franchise when colName is business data.

---

### 2.2 App.js — query(…) with where(…)

| Line   | Collection  | where clause                          | franchiseId in query? |
|--------|-------------|---------------------------------------|------------------------|
| 16670  | activities  | `where('islem', '==', 'Silindi')`     | **No**                 |

All other queries use only `orderBy` / `limit`, no `where`.

---

### 2.3 VacationTimesView.js

| Line | Operation   | Collection    | Filters by franchiseId? | Should be franchise-filtered? |
|------|-------------|---------------|--------------------------|--------------------------------|
| 37–38 | onSnapshot | vacationTimes | **No**                   | **Yes** (business)            |
| 160  | deleteDoc   | vacationTimes | N/A                      | N/A                           |
| 218  | updateDoc   | vacationTimes | N/A                      | N/A                           |
| 222  | setDoc      | vacationTimes | N/A                      | Payload: **No** franchiseId → **Yes** (add) |

---

### 2.4 AdminFranchiseDashboard.js

| Line | Operation | Collection  | Filters by franchiseId? | Should be franchise-filtered? |
|------|------------|-------------|--------------------------|--------------------------------|
| 62   | getDocs    | users       | No                       | No (admin lists all users)    |
| 93–94 | onSnapshot | franchises | No                       | No (system list)              |
| 77   | updateDoc  | franchises  | N/A                      | No (system)                   |
| 458  | addDoc     | franchises  | N/A                      | No (system); payload has franchiseId (selectedCountry.id) |

---

### 2.5 AdminFranchiseDetailView.js

| Line  | Operation | Collection | Filters by franchiseId? | Should be franchise-filtered? |
|-------|-----------|------------|--------------------------|--------------------------------|
| 42–44 | query     | users      | **Yes** `where('franchiseId', '==', franchise.franchiseId \|\| franchise.id)` | N/A (correct) |
| 47   | onSnapshot| users (query above) | Yes | N/A |
| 58   | updateDoc | franchises | N/A | No (system) |
| 105  | updateDoc | users      | N/A | No (user doc) |
| 112  | updateDoc | franchises | N/A | No |
| 127  | updateDoc | users      | N/A | No |
| 513  | updateDoc | users      | N/A | No |
| 521  | updateDoc | franchises | N/A | No |
| 533  | updateDoc | franchises | N/A | No |
| 810  | setDoc    | users      | N/A | No (user doc has franchiseId) |
| 824  | updateDoc | franchises | N/A | No |
| 1014 | updateDoc | franchises | N/A | No |
| 1176 | updateDoc | users      | N/A | No |
| 461–462 | getDocs | users, franchises | No (one-off load) | users: by franchise in UI; franchises: no |

---

### 2.6 AdminUserManagementView.js

| Line | Operation   | Collection  | Filters by franchiseId? | Should be franchise-filtered? |
|------|-------------|-------------|--------------------------|--------------------------------|
| 111  | onSnapshot  | users       | **No**                   | Admin: can stay global or filter in UI |
| 128  | onSnapshot  | franchises  | No                       | No (system)                   |
| 230  | updateDoc   | users       | N/A                      | No                            |
| 245  | updateDoc   | users       | N/A                      | No                            |
| 264  | deleteDoc   | users       | N/A                      | No                            |
| 666  | updateDoc   | users       | N/A                      | No                            |

---

### 2.7 Archived: `_deprecated/App_with_ocr.js` & `_deprecated/App_Updated.js`

Same patterns as App.js for the collections they use: `araclar`, `servisKayitlari`, `iadeIslemleri`, `office_operations`, `servisFirmalari`, `activities`, plus ERP: `transactions`, `customers`, `accidents`, `protocols`, `accidentCodes`. None of these operations filter or write `franchiseId` in the audited code. All business collections **should** be franchise-filtered on read and include `franchiseId` on write where applicable.

---

## 3. New document creation — fields saved and franchiseId gap

When the **web app** creates new documents, the following fields are saved. **None** of these payloads currently include `franchiseId`; all business creates **should** add it once the app has a current franchise context.

| File:Line | Collection           | Method | Fields saved | Add franchiseId? |
|-----------|----------------------|--------|--------------|-------------------|
| App.js:1222 | activities           | addDoc | tip, aciklama, tarih, kullaniciAdi, kullaniciEmail | **Yes** |
| App.js:1596 | activities           | addDoc | type, description, tarih, userId | **Yes** |
| App.js:5210 | trafficFines         | addDoc | plate, customerName, date, amount, photo, status, resCode, referenceNumber | **Yes** |
| App.js:5613 | bankingTransactions  | addDoc | amount, date, status, photo, resCode, referenceNumber, createdBy, createdByName, createdAt | **Yes** |
| App.js:6781 | araclar              | setDoc | id, ...formData (plaka, marka, model, renk, kategori, vignetteVar, anahtarSayisi, kafaKagidiVar, km), kayitTarihi, hasarKayitlari, qrCode | **Yes** |
| App.js:8373 | iadeIslemleri         | setDoc | id, aracId, aracPlaka, iadeTarihi, notlar, hasarSayisi, fotografSayisi | **Yes** |
| App.js:9321 | servisKayitlari      | setDoc | id, ...formData, tutar, kilometre, tarih | **Yes** |
| App.js:9701 | servisFirmalari       | addDoc | ...formData, kayitTarihi | **Yes** |
| App.js:10832 | office_operations    | setDoc | id, type, date, amount, photos, vehiclePlate, posCount, posAmounts, notes, isCompleted, resCode, referenceNumber, plate, customerName, status | **Yes** |
| App.js:11143 | office_operations    | setDoc | (same shape, update) | **Yes** (if creating new, ensure franchiseId) |
| App.js:11766 | shuttleEntries       | addDoc | id, documentId, customerCount, entryType, timestamp, date, driverName, driverUID, sessionId | **Yes** |
| App.js:12621 | protocolTemplates    | setDoc | templateCode, templateName, templateType, templatePath, requiredFields, optionalFields, baseCost, isActive, createdAt, updatedAt, fileName, fileBase64?, templateUrl?, storagePath? | No (system) |
| App.js:14377 | semesInvoices         | setDoc | invoiceId, fileName, fileType, storagePath, storageUrl, fileBase64, uploadedAt, uploadedBy | **Yes** |
| App.js:15191 | protocols             | setDoc | protocolId, protocolType, protocolName, templatePath, templateCode, templateFields, baseCost, vehiclePlate, customerName, reservationNumber, checkInDate, checkOutDate, fieldValues, documentBase64, documentSize, status, paymentStatus, requiredAmount, paidAmount, createdAt, updatedAt, createdBy, updatedBy | **Yes** |
| App.js:18326 | assistantCompanies    | setDoc | ...companyToSave, id, documentId | **Yes** |
| VacationTimesView.js:222 | vacationTimes | setDoc | id, documentId, employeeName, startDate, endDate, isActive, createdBy, createdAt | **Yes** |
| AdminFranchiseDashboard.js:458 | franchises | addDoc | franchiseId (selectedCountry.id), name, countryCode, ..., isActive, createdAt, etc. | No (franchise doc itself) |
| AdminFranchiseDetailView.js:810 | users | setDoc | email, firstName, lastName, role, franchiseId, countryCode, isActive, createdAt, updatedAt | No (user doc; franchiseId already set) |

---

## 4. Summary

- **Only franchise-filtered read in web app:** `AdminFranchiseDetailView.js` users query with `where('franchiseId', '==', franchise.franchiseId || franchise.id)`.
- **No other** collection read or listener in the audited files filters by `franchiseId`; all business data (araclar, servisler/servisKayitlari, iadeIslemleri, exitIslemleri, activities, office_operations, servisFirmalari, trafficFines, bankingTransactions, additionalSales, office_Return, shuttleEntries, workSchedules, assistantCompanies, semesInvoices, protocols, vacationTimes) **should** be scoped by franchise (query/where or client-side filter with security in rules).
- **System data** that should **not** be franchise-filtered (or not by franchiseId): `users` (by uid for profile), `franchises`, `protocolTemplates`.
- Every **create** in business collections listed above currently **omits `franchiseId`**; each should add `franchiseId` (and optionally `countryCode` where relevant) from the current user/franchise context.

---

## 5. Files with Firestore usage (no omissions)

| File | Reads | Writes | Listens | Queries with where |
|------|-------|--------|---------|----------------------|
| **App.js** | getDoc, getDocs (many) | addDoc, setDoc, updateDoc, deleteDoc (many) | onSnapshot (all main business collections, 2 copies) | activities (islem=='Silindi'); dynamic col |
| **`_deprecated/App_with_ocr.js`** | getDoc, getDocs | addDoc, setDoc, updateDoc, deleteDoc | onSnapshot (araclar, servisKayitlari, iadeIslemleri, activities, office_operations, servisFirmalari, ERP) | activities orderBy only |
| **`_deprecated/App_Updated.js`** | getDocs (users), getDocs (collections) | addDoc (activities) | onSnapshot (same as App_with_ocr) | activities orderBy only |
| **VacationTimesView.js** | — | setDoc, updateDoc, deleteDoc | onSnapshot vacationTimes | orderBy('startDate','desc') |
| **AdminFranchiseDashboard.js** | getDocs(users) | addDoc(franchises), updateDoc(franchises) | onSnapshot(franchises) | — |
| **AdminFranchiseDetailView.js** | getDocs(users), getDocs(franchises) | setDoc(users), updateDoc(users), updateDoc(franchises) | onSnapshot(users with where franchiseId) | where('franchiseId', '==', …) |
| **AdminUserManagementView.js** | — | updateDoc(users), deleteDoc(users) | onSnapshot(users), onSnapshot(franchises) | — |

No other `.js` files under `src/` perform Firestore operations.

---

**Next steps (recommended):**

1. Introduce a global “current franchise” (e.g. from user profile or selector) and use it in all business reads/writes.
2. Add `where('franchiseId', '==', currentFranchiseId)` (and composite index if needed) to every business collection read/query and onSnapshot.
3. Add `franchiseId` (and optionally `countryCode`) to every document create/update payload for business collections listed in Section 3.
4. Enforce franchise scoping in Firestore rules so reads/writes are limited by `franchiseId`.
5. Ensure report/debug flows that use dynamic `colName`/`col.name` only query collections allowed for the current franchise and, when writing, set `franchiseId`.
