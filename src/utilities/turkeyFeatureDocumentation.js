/** Turkey-only in-app feature guides — mirrors iOS `TurkeyDocumentationTopic`. */

export const TURKEY_DOC_TOPICS = [
    { id: 'operations_hub', icon: 'operations' },
    { id: 'checkout', icon: 'checkout' },
    { id: 'return', icon: 'returns' },
    { id: 'damage', icon: 'damage' },
];

const STRINGS = {
    en: {
        title: 'Documentation',
        settingsSection: 'Documentation',
        settingsFooter:
            'Guides for Turkey operations: day planner, checkout, return, and damage recording.',
        listHeader: 'Feature guides',
        listFooter:
            'Read-only help for front-desk and garage staff. Choose a guide language below.',
        languageLabel: 'Guide language',
        openGuide: 'Open guide',
        close: 'Close',
        topics: {
            operations_hub: {
                title: 'Operations Hub',
                subtitle: 'Plan the day’s check-outs and returns in one place.',
                sections: [
                    {
                        title: 'Day planner overview',
                        body: 'The Operations view shows every check-out and return scheduled for the selected calendar day. Use it as your shift dashboard before opening individual records.',
                        bullets: [
                            'Change the day with the arrows or open the date picker.',
                            'Completed rows stay visible for reference; waiting rows are actionable.',
                        ],
                    },
                    {
                        title: 'Check-out column',
                        body: 'Turkey franchises see a Waiting block above Completed check-outs.',
                        bullets: [
                            'Click a waiting row to continue checkout documentation.',
                            'NAV codes and plates help match iOS and kiosk handovers.',
                            'Completed or parked check-outs move out of Waiting.',
                        ],
                    },
                    {
                        title: 'Return column',
                        body: 'Returns mirror check-outs: pending work first, then completed returns for the day.',
                        bullets: [
                            'Expected returns from an open check-out appear while the vehicle is still out.',
                            'Open a waiting return to review photos, fuel, and customer data.',
                            'Generate return PDFs from the detail modal when needed.',
                        ],
                    },
                    {
                        title: 'Search',
                        body: 'Quickly find a reservation when the desk is busy.',
                        bullets: [
                            'Search by plate, NAV code, or customer email.',
                            'Rows are grouped by waiting vs. done status.',
                        ],
                    },
                ],
            },
            checkout: {
                title: 'Checkout',
                subtitle: 'Document vehicle condition and customer acceptance at pick-up.',
                sections: [
                    {
                        title: 'Checkout list',
                        body: 'The Checkout view lists all handover operations for your franchise.',
                        bullets: [
                            'Filter by date or photo status to find incomplete handovers.',
                            'NAV codes link records to damage and return workflows.',
                        ],
                    },
                    {
                        title: 'Photos & details',
                        body: 'Open a record to review handover photos, notes, and branches.',
                        bullets: [
                            'Turkey PDFs use bilingual templates with NAV branding.',
                            'Compare photo counts before marking work complete on mobile.',
                        ],
                    },
                    {
                        title: 'PDF export',
                        body: 'Generate checkout PDFs from the row actions or detail modal.',
                        bullets: [
                            'Turkish and English PDF variants are available for Turkey franchises.',
                            'PDFs include vehicle, customer, and photo evidence.',
                        ],
                    },
                ],
            },
            return: {
                title: 'Return',
                subtitle: 'Compare vehicle condition at drop-off against checkout.',
                sections: [
                    {
                        title: 'Return list',
                        body: 'The Returns view lists completed and in-progress return operations.',
                        bullets: [
                            'Search by plate, NAV code, or notes.',
                            'Filter by date or photo status like checkout.',
                        ],
                    },
                    {
                        title: 'Detail review',
                        body: 'Open a return to inspect photos, fuel, kilometres, and checklist data synced from iOS.',
                        bullets: [
                            'Linked check-outs provide comparison context.',
                            'Customer email is used when return PDFs are sent.',
                        ],
                    },
                    {
                        title: 'PDF export',
                        body: 'Turkey franchises can download bilingual return PDFs from the detail view.',
                        bullets: [
                            'Return PDFs highlight checkout vs. return photos when available.',
                            'Use PDFs for customer sign-off archives.',
                        ],
                    },
                ],
            },
            damage: {
                title: 'Damage recording',
                subtitle: 'Log body damage with NAV linkage and photo evidence.',
                sections: [
                    {
                        title: 'Damage operations list',
                        body: 'All damage records across the fleet appear in Damage Operations.',
                        bullets: [
                            'Search by NAV code, plate, or notes.',
                            'Filter by date range to audit recent incidents.',
                        ],
                    },
                    {
                        title: 'Record contents',
                        body: 'Each damage entry stores photos, handover date, and repair status on the vehicle.',
                        bullets: [
                            'Turkey uses NAV codes on damage PDFs.',
                            'Compare checkout and return photos in the detail tabs.',
                        ],
                    },
                    {
                        title: 'PDF & editing',
                        body: 'Generate damage PDFs or edit records from the context menu.',
                        bullets: [
                            'Soft-deleted damages are hidden from the list but kept in audit history.',
                            'Use consistent photos for insurance and franchise reporting.',
                        ],
                    },
                ],
            },
        },
    },
    tr: {
        title: 'Dokümantasyon',
        settingsSection: 'Dokümantasyon',
        settingsFooter:
            'Türkiye operasyonları için rehberler: gün planlayıcı, çıkış, iade ve hasar kaydı.',
        listHeader: 'Özellik rehberleri',
        listFooter:
            'Ön büro ve garaj personeli için salt okunur yardım. Aşağıdan rehber dilini seçin.',
        languageLabel: 'Rehber dili',
        openGuide: 'Rehberi aç',
        close: 'Kapat',
        topics: {
            operations_hub: {
                title: 'Operasyon Merkezi',
                subtitle: 'Günün çıkış ve iade işlemlerini tek ekranda planlayın.',
                sections: [
                    {
                        title: 'Gün planlayıcıya genel bakış',
                        body: 'Operasyon görünümü, seçili takvim günü için planlanan tüm çıkış ve iade kayıtlarını gösterir. Kayıtları açmadan önce vardiya panonuz olarak kullanın.',
                        bullets: [
                            'Günü oklarla değiştirin veya tarih seçiciyi açın.',
                            'Tamamlanan satırlar referans için kalır; bekleyen satırlar işlem yapılabilir.',
                        ],
                    },
                    {
                        title: 'Çıkış sütunu',
                        body: 'Türkiye bayilerinde Tamamlanan çıkışların üstünde Bekleyen bloğu görünür.',
                        bullets: [
                            'Bekleyen satıra tıklayarak çıkış belgelerine devam edin.',
                            'NAV kodları ve plakalar iOS ve kiosk teslimlerini eşleştirir.',
                            'Tamamlanan veya park edilmiş çıkışlar Bekleyen listesinden düşer.',
                        ],
                    },
                    {
                        title: 'İade sütunu',
                        body: 'İadeler çıkışlarla aynı mantıkta çalışır: önce bekleyen işler, sonra günün tamamlanan iadeleri.',
                        bullets: [
                            'Açık çıkıştan beklenen iadeler araç dışarıdayken görünür.',
                            'Bekleyen iadeyi açarak fotoğraf, yakıt ve müşteri verilerini inceleyin.',
                            'Gerekirse detay penceresinden iade PDF\'i oluşturun.',
                        ],
                    },
                    {
                        title: 'Arama',
                        body: 'Saha yoğunken rezervasyonu hızla bulun.',
                        bullets: [
                            'Plaka, NAV kodu veya müşteri e-postası ile arayın.',
                            'Satırlar bekleyen ve tamamlanan duruma göre gruplanır.',
                        ],
                    },
                ],
            },
            checkout: {
                title: 'Çıkış',
                subtitle: 'Araç durumunu ve müşteri kabulünü teslim anında belgeleyin.',
                sections: [
                    {
                        title: 'Çıkış listesi',
                        body: 'Çıkış görünümü bayinizdeki tüm teslim işlemlerini listeler.',
                        bullets: [
                            'Eksik teslimleri bulmak için tarih veya fotoğraf filtresi kullanın.',
                            'NAV kodları hasar ve iade akışlarına bağlanır.',
                        ],
                    },
                    {
                        title: 'Fotoğraflar ve detaylar',
                        body: 'Teslim fotoğrafları, notlar ve şube bilgilerini incelemek için kaydı açın.',
                        bullets: [
                            'Türkiye PDF\'leri NAV markalı çift dilli şablonlar kullanır.',
                            'Mobilde işi tamamlamadan önce fotoğraf sayısını karşılaştırın.',
                        ],
                    },
                    {
                        title: 'PDF dışa aktarma',
                        body: 'Satır eylemlerinden veya detay penceresinden çıkış PDF\'i oluşturun.',
                        bullets: [
                            'Türkiye bayileri için Türkçe ve İngilizce PDF seçenekleri vardır.',
                            'PDF\'ler araç, müşteri ve fotoğraf kanıtını içerir.',
                        ],
                    },
                ],
            },
            return: {
                title: 'İade',
                subtitle: 'Teslim anındaki durumla bırakıştaki durumu karşılaştırın.',
                sections: [
                    {
                        title: 'İade listesi',
                        body: 'İade görünümü tamamlanan ve devam eden iade işlemlerini listeler.',
                        bullets: [
                            'Plaka, NAV kodu veya notlarla arayın.',
                            'Çıkışta olduğu gibi tarih veya fotoğraf filtresi kullanın.',
                        ],
                    },
                    {
                        title: 'Detay inceleme',
                        body: 'iOS\'tan senkronize fotoğraf, yakıt, kilometre ve kontrol listesi için iadeyi açın.',
                        bullets: [
                            'Bağlı çıkışlar karşılaştırma bağlamı sağlar.',
                            'İade PDF\'leri gönderilirken müşteri e-postası kullanılır.',
                        ],
                    },
                    {
                        title: 'PDF dışa aktarma',
                        body: 'Türkiye bayileri detay görünümünden çift dilli iade PDF\'i indirebilir.',
                        bullets: [
                            'İade PDF\'leri mümkün olduğunda çıkış ve iade fotoğraflarını vurgular.',
                            'PDF\'leri müşteri onay arşivi için kullanın.',
                        ],
                    },
                ],
            },
            damage: {
                title: 'Hasar kaydı',
                subtitle: 'NAV bağlantılı ve fotoğraflı gövde hasarı kaydedin.',
                sections: [
                    {
                        title: 'Hasar operasyonları listesi',
                        body: 'Filodaki tüm hasar kayıtları Hasar Operasyonları\'nda görünür.',
                        bullets: [
                            'NAV kodu, plaka veya notlarla arayın.',
                            'Son olayları denetlemek için tarih aralığı filtresi kullanın.',
                        ],
                    },
                    {
                        title: 'Kayıt içeriği',
                        body: 'Her hasar kaydı araç üzerinde fotoğraf, teslim tarihi ve onarım durumu tutar.',
                        bullets: [
                            'Türkiye hasar PDF\'lerinde NAV kodu kullanılır.',
                            'Detay sekmelerinde çıkış ve iade fotoğraflarını karşılaştırın.',
                        ],
                    },
                    {
                        title: 'PDF ve düzenleme',
                        body: 'Bağlam menüsünden hasar PDF\'i oluşturun veya kayıtları düzenleyin.',
                        bullets: [
                            'Yumuşak silinen hasarlar listede gizlenir ancak denetim geçmişinde kalır.',
                            'Sigorta ve bayi raporları için tutarlı fotoğraflar kullanın.',
                        ],
                    },
                ],
            },
        },
    },
    de: {
        title: 'Dokumentation',
        settingsSection: 'Dokumentation',
        settingsFooter:
            'Anleitungen für Türkei-Operationen: Tagesplaner, Check-out, Rückgabe und Schadenserfassung.',
        listHeader: 'Funktionsleitfäden',
        listFooter:
            'Schreibgeschützte Hilfe für Frontdesk und Werkstatt. Leitfadensprache unten wählen.',
        languageLabel: 'Leitfadensprache',
        openGuide: 'Leitfaden öffnen',
        close: 'Schließen',
        topics: {
            operations_hub: {
                title: 'Operations-Hub',
                subtitle: 'Check-outs und Rückgaben des Tages an einem Ort planen.',
                sections: [
                    {
                        title: 'Tagesplaner – Überblick',
                        body: 'Die Operations-Ansicht zeigt alle Check-outs und Rückgaben für den gewählten Kalendertag. Nutzen Sie sie als Schicht-Dashboard, bevor Sie einzelne Datensätze öffnen.',
                        bullets: [
                            'Tag mit Pfeilen wechseln oder Datumsauswahl öffnen.',
                            'Abgeschlossene Zeilen bleiben sichtbar; wartende Zeilen sind bearbeitbar.',
                        ],
                    },
                    {
                        title: 'Check-out-Spalte',
                        body: 'Türkei-Franchises sehen über abgeschlossenen Check-outs einen Wartend-Block.',
                        bullets: [
                            'Wartende Zeile anklicken, um Check-out-Dokumentation fortzusetzen.',
                            'NAV-Codes und Kennzeichen ordnen iOS- und Kiosk-Übergaben zu.',
                            'Abgeschlossene oder geparkte Check-outs verschwinden aus Wartend.',
                        ],
                    },
                    {
                        title: 'Rückgabe-Spalte',
                        body: 'Rückgaben spiegeln Check-outs: zuerst offene Arbeit, dann abgeschlossene Rückgaben.',
                        bullets: [
                            'Erwartete Rückgaben aus offenen Check-outs erscheinen, solange das Fahrzeug draußen ist.',
                            'Wartende Rückgabe öffnen für Fotos, Kraftstoff und Kundendaten.',
                            'Bei Bedarf Rückgabe-PDF aus dem Detailmodal erzeugen.',
                        ],
                    },
                    {
                        title: 'Suche',
                        body: 'Reservierung schnell finden, wenn der Schalter voll ist.',
                        bullets: [
                            'Suche nach Kennzeichen, NAV-Code oder Kunden-E-Mail.',
                            'Zeilen sind nach wartend vs. erledigt gruppiert.',
                        ],
                    },
                ],
            },
            checkout: {
                title: 'Check-out',
                subtitle: 'Fahrzeugzustand und Kundenannahme bei Abholung dokumentieren.',
                sections: [
                    {
                        title: 'Check-out-Liste',
                        body: 'Die Check-out-Ansicht listet alle Übergaben Ihrer Franchise.',
                        bullets: [
                            'Nach Datum oder Fotostatus filtern, um offene Übergaben zu finden.',
                            'NAV-Codes verknüpfen Datensätze mit Schaden- und Rückgabe-Workflows.',
                        ],
                    },
                    {
                        title: 'Fotos & Details',
                        body: 'Datensatz öffnen für Übergabefotos, Notizen und Standorte.',
                        bullets: [
                            'Türkei-PDFs nutzen zweisprachige Vorlagen mit NAV-Branding.',
                            'Fotoanzahl prüfen, bevor mobile Arbeit abgeschlossen wird.',
                        ],
                    },
                    {
                        title: 'PDF-Export',
                        body: 'Check-out-PDFs über Zeilenaktionen oder Detailmodal erzeugen.',
                        bullets: [
                            'Für Türkei-Franchises gibt es türkische und englische PDF-Varianten.',
                            'PDFs enthalten Fahrzeug, Kunde und Fotobeleg.',
                        ],
                    },
                ],
            },
            return: {
                title: 'Rückgabe',
                subtitle: 'Fahrzeugzustand bei Rückgabe mit Check-out vergleichen.',
                sections: [
                    {
                        title: 'Rückgabe-Liste',
                        body: 'Die Rückgabe-Ansicht listet abgeschlossene und laufende Rückgaben.',
                        bullets: [
                            'Suche nach Kennzeichen, NAV-Code oder Notizen.',
                            'Wie beim Check-out nach Datum oder Fotostatus filtern.',
                        ],
                    },
                    {
                        title: 'Detailprüfung',
                        body: 'Rückgabe öffnen für Fotos, Kraftstoff, Kilometer und Checkliste von iOS.',
                        bullets: [
                            'Verknüpfte Check-outs liefern Vergleichskontext.',
                            'Kunden-E-Mail wird beim Versand von Rückgabe-PDFs genutzt.',
                        ],
                    },
                    {
                        title: 'PDF-Export',
                        body: 'Türkei-Franchises können zweisprachige Rückgabe-PDFs aus der Detailansicht laden.',
                        bullets: [
                            'Rückgabe-PDFs heben Check-out- vs. Rückgabefotos hervor, wenn verfügbar.',
                            'PDFs für Kundenbestätigungsarchive nutzen.',
                        ],
                    },
                ],
            },
            damage: {
                title: 'Schadenserfassung',
                subtitle: 'Karosserieschäden mit NAV-Verknüpfung und Fotobelegen erfassen.',
                sections: [
                    {
                        title: 'Schaden-Operationsliste',
                        body: 'Alle Schadeneinträge der Flotte erscheinen unter Schaden-Operationen.',
                        bullets: [
                            'Suche nach NAV-Code, Kennzeichen oder Notizen.',
                            'Datumsbereich filtern, um kürzliche Vorfälle zu prüfen.',
                        ],
                    },
                    {
                        title: 'Datensatzinhalt',
                        body: 'Jeder Schadeneintrag speichert Fotos, Übergabedatum und Reparaturstatus am Fahrzeug.',
                        bullets: [
                            'Türkei nutzt NAV-Codes auf Schaden-PDFs.',
                            'Check-out- und Rückgabefotos in Detail-Tabs vergleichen.',
                        ],
                    },
                    {
                        title: 'PDF & Bearbeitung',
                        body: 'Schaden-PDFs erzeugen oder Datensätze über Kontextmenü bearbeiten.',
                        bullets: [
                            'Weich gelöschte Schäden sind in der Liste ausgeblendet, bleiben aber im Audit.',
                            'Einheitliche Fotos für Versicherung und Franchise-Berichte nutzen.',
                        ],
                    },
                ],
            },
        },
    },
};

export function normalizeTurkeyDocsLang(raw) {
    const s = String(raw || '').trim().toLowerCase();
    if (s === 'tr' || s === 'tur' || s === 'turkish') return 'tr';
    if (s === 'de' || s === 'deu' || s === 'german') return 'de';
    return 'en';
}

export function readTurkeyDocsLanguage() {
    try {
        return normalizeTurkeyDocsLang(localStorage.getItem('AppLanguage'));
    } catch {
        return 'en';
    }
}

export function writeTurkeyDocsLanguage(lang) {
    const normalized = normalizeTurkeyDocsLang(lang);
    try {
        localStorage.setItem('AppLanguage', normalized);
    } catch {
        /* ignore quota errors */
    }
    return normalized;
}

export function turkeyDocsUi(lang) {
    const L = STRINGS[normalizeTurkeyDocsLang(lang)] || STRINGS.en;
    return L;
}

export function turkeyDocsTopic(lang, topicId) {
    const L = turkeyDocsUi(lang);
    return L.topics[topicId] || null;
}

export function isTurkeyFranchiseIdForDocs(franchiseId) {
    const fid = String(franchiseId || '').trim().toUpperCase();
    return fid.startsWith('TR');
}
