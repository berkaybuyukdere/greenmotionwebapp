# Stripe UI — Geri alma

## Snapshot commit (değişiklikten önce)

```
f4fbca0 — chore(ui): snapshot ERPX styles before Stripe design-system refresh
```

Sadece CSS dosyalarını eski haline döndürmek için:

```bash
git checkout f4fbca0 -- green-motion-web/src/styles/erpx-stripe.css green-motion-web/src/index.css
```

Sidebar / layout değişikliklerini de geri almak için `App.js` içindeki `erpx-sidebar`, `erpx-main`, `erpx-topbar` satırlarını önceki commit ile karşılaştırın.

## Referans

- `docs/STRIPE_UI_REFERENCE.md` — Stripe token ve bileşen dokümantasyonu
- Kaynak mockup: `transactions.html`, `accounting.html` (Downloads)
