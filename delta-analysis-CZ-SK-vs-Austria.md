# Delta Funzionale CRR: Czech Republic & Slovakia vs Austria

> **Fonte AS-IS:** UniCredit FSD – Functional Specification Document v4.6 (Austria)
> **Fonte TO-BE:** CRR_RiskElement_Instance_CZ&SK_v9.xlsx + Requirement Gathering CZ SK periodic review V2 + UCB CZSK automated KYC review rules v3
> **Data analisi:** 2026-04-09

---

## Executive Summary

Il sistema CRR attualmente implementato per UniCredit Austria (AS-IS) deve essere esteso per supportare le country CZ e SK. I delta non riguardano un cambio radicale di architettura: il modello di rischio rimane basato su Rule-Based + Algorithm-Based Assessment con gli stessi 30 risk element di base. Tuttavia sono presenti **differenze significative** su:

1. Nuovi segmenti cliente (Occasional customers)
2. Nuovi risk element locali (branch/subsidiary in sanctioned country, FATF granularity, country of destination of transaction)
3. Regole di automatic KYC review più stringenti (residenza + cittadinanza, note cliente, ID più restrittivo)
4. Online model completamente diverso per CZ/SK (quasi nessun elemento prodotto/transazione; SoW solo EDD)
5. Gestione AML Block parzialmente differente
6. Calcolo data scadenza KYC condizionato all'approvazione della relazione

---

## 1. Nuovi Segmenti Cliente

### Descrizione

Austria AS-IS definisce i seguenti segmenti: Retail, PB Individual, PB LP, Corporate (no CIB), CIB, FIBS.

CZ/SK TO-BE introduce **due nuovi segmenti** non presenti in Austria:

| Segmento nuovo | Tipo | Note |
|---|---|---|
| **Occasional customers Individual** | Persone fisiche | Clienti occasionali (persone fisiche) |
| **Occasional customers LP** | Persone giuridiche | Clienti occasionali (persone giuridiche) |

### Impatto da implementare

- Creare i due nuovi jurisdiction/segmenti nel sistema CRR per CZ e SK
- Per questi segmenti **non viene calcolata la data di scadenza KYC** (`If the customer belongs to the Occasional Segment, the CRR module shall not calculate any KYC expiration date`)
- Nel modello batch, i clienti Occasional **non** sono eligible per nessun risk element dei prodotti, cash transactions, o SoW
- Nel modello online, i clienti Occasional Individual hanno un sottoinsieme specifico di risk element (vedi §5)

---

## 2. Nuovi Risk Element (Batch Model)

### 2.1 Risk Element: Branch/Subsidiary in Sanctioned Country *(nuovo – Local Specific)*

**Non presente in Austria.** CZ/SK introduce un risk element completamente nuovo che misura se il cliente ha filiali o sussidiarie in paesi sanzionati.

| Parametro | Valore |
|---|---|
| Risk Factor | `geography` |
| Risk Element | `branch_subsidiary_in_sanctioned_country` |
| Segmenti applicabili | Corporate (no CIB), CIB, FIBS + Corr. Banks |
| Tipo | Local specifics |

**Risk instances applicabili:**

- `eu_high_risk_third_countries`
- `sanctioned_country`
- `fatf_black_grey_country_no_eu`
- `fatf_black_grey_country_eu`
- `very_high`, `high`, `medium`, `low`, `domestic`

**Cosa implementare:** Aggiungere il risk element `branch_subsidiary_in_sanctioned_country` al modello batch CZ/SK per i segmenti Corporate, CIB, FIBS. Configurare tutte le risk instances elencate sopra con i relativi score. Il valore viene fornito dalla source system (flag booleano + paese).

---

### 2.2 Risk Element Geography: Granularità FATF *(nuovo – Local Specific)*

Austria usa categorie geografiche aggregate. CZ/SK introduce **due istanze geografiche FATF specifiche** come Local Specifics, per tutti i risk element geografici (residenza, country of legal address, country of incorporation/HQ, cittadinanza):

| Risk Instance | Descrizione |
|---|---|
| `fatf_black_grey_country_no_eu` | Paese in lista grigia/nera FATF ma **non** in lista EU |
| `fatf_black_grey_country_eu` | Paese in lista grigia/nera FATF **e** in lista EU |

**Applicabilità:**

| Risk Element | Segmenti |
|---|---|
| `residence` | Retail, PB&WM Individual |
| `country_of_legal_address` | Corporate (no CIB), CIB, FIBS |
| `country_of_incorporation_/_hq_location` | Corporate (no CIB), CIB, FIBS |
| `citizenship` | Retail, PB&WM Individual |

**Cosa implementare:** Aggiungere le due risk instances `fatf_black_grey_country_no_eu` e `fatf_black_grey_country_eu` a tutti e quattro i risk element geografici sopra elencati, nel modello batch CZ/SK. Configurare score separati per ciascuna istanza (potrebbero avere penalità diverse).

---

### 2.3 Risk Element Related Parties: Istanze locali *(nuovo – Local Specific)*

Austria non ha queste istanze. CZ/SK aggiunge due risk instances Local Specific all'elemento `related_parties`, applicabili a Corporate (no CIB), CIB, FIBS:

| Risk Instance | Descrizione |
|---|---|
| `ubo_authorized_signatory_resident_or_citizen_in_sanctioned_country_eu_high_risk_third_country_fatf_grey_black_no_EU_list_country` | UBO/firmatario autorizzato residente/cittadino in paese sanzionato, EU high-risk, o FATF grey/black (no EU) |
| `ubo_authorized_signatory_resident_or_citizen_in_fatf_grey_black_EU_list_country` | UBO/firmatario autorizzato residente/cittadino in paese FATF grey/black e in lista EU |

**Cosa implementare:** Aggiungere le due risk instances al risk element `related_parties` nel modello batch CZ/SK. I dati vengono dalla gestione delle parti correlate (UBO table, authorized signatories).

---

### 2.4 Auto-Low: Central Banks – Scope Ridotto per CZ/SK

**Austria AS-IS:** `central_banks_in_low_jurisdictions` è applicabile a **FIBS + Corr. Banks** (e probabilmente Corporate/CIB in Austria).

**CZ/SK TO-BE:** Questa auto-low **non è applicabile** a Corporate (no CIB) e CIB per CZ/SK. Rimane applicabile **solo a FIBS + Corr. Banks**.

**Cosa implementare:** Limitare l'applicabilità del risk element `central_banks_in_low_jurisdictions` al solo segmento FIBS nelle jurisdiction CZ e SK (escludere Corporate e CIB che in Austria erano in scope).

---

## 3. Nuovo Modello Online CZ/SK *(differenze sostanziali)*

Il modello online di CZ/SK è **completamente diverso** dal modello batch Austria. La quasi totalità dei risk element legati a prodotti, cash transactions, e transazioni con paesi ad alto rischio è **non applicabile** nell'online CZ/SK.

### 3.1 Elementi ESCLUSI dall'online CZ/SK (presenti nel batch Austria)

| Risk Factor | Risk Element | Note |
|---|---|---|
| `products_service_transaction` | `trx_vs_high_and_very_high_risk_countries` (tutti i threshold) | Non applicabile online CZ/SK |
| `products_service_transaction` | `cash_trx` (threshold 1/2/3) | Non applicabile online CZ/SK |
| `products_service_transaction` | `products` (tutti: accounts, safety boxes, loans, prepaid cards, ecc.) | Non applicabile online CZ/SK |
| `products_service_transaction` | `sar_sent_to_fiu` | Non applicabile nel modello online standard (solo occasional ha `sar_sent_to_fiu_occasional`) |

**Cosa implementare:** Il modello di scoring online per CZ/SK deve essere configurato senza questi parametri (o con score zero). Non aspettarsi valori da questi campi per il calcolo online.

---

### 3.2 Source of Wealth nel modello online CZ/SK: solo EDD

**Austria batch:** le SoW instances per Retail e Corporate sono **Applicable** (contribuiscono al CRR score).

**CZ/SK online:** le SoW instances per Retail hanno valore **"only EDD"** (Enhanced Due Diligence only — vengono raccolte ma non entrano nel calcolo CRR score); per Corporate (no CIB) e CIB le SoW instances sono anch'esse **"only EDD"**.

| Risk Element | Instance (esempi) | Austria Batch Retail | CZ/SK Online Retail |
|---|---|---|---|
| `source_of_wealth` | `inheritance_gifts_donations` | Applicable | only EDD |
| `source_of_wealth` | `real_estate_sale` | Applicable | only EDD |
| `source_of_wealth` | `employment_and_pension` | Applicable | only EDD |
| `source_of_wealth` | `arts_and_antiques_dealers` | Applicable | only EDD (PB&WM Ind.) |

**Eccezione:** `origin_from_high_risk_or_very_high_risk_country` nel SoW è applicabile per PB&WM Individual nell'online CZ/SK (solo paper form per Austria; CZ/SK: applicabile in KYC Questionnaire).

**Cosa implementare:** Per il modello online CZ/SK, le SoW instances devono essere marcate come EDD-only: vengono visualizzate nel KYC Questionnaire ma non influenzano il punteggio CRR nel calcolo online.

---

### 3.3 Nuovo Risk Element Online: Country of Destination of Transaction *(solo CZ/SK, solo Occasional)*

**Non presente in Austria.** CZ/SK online introduce un risk element per le transazioni dei clienti occasionali:

| Parametro | Valore |
|---|---|
| Risk Factor | `products_service_transaction` |
| Risk Element | `country_of_destination_of_transaction` |
| Segmento | **Occasional customers Individual** (solo istanza `domestic` applicabile) |
| Tipo | Group |

**Risk instances:** eu_high_risk_third_countries, sanctioned_country, very_high, high, medium, low, `domestic` (quest'ultima la sola applicabile per Occasional Individual)

**Cosa implementare:** Aggiungere il risk element `country_of_destination_of_transaction` al modello online CZ/SK, attivo esclusivamente per il segmento Occasional customers Individual. Ricevere il dato dalla source system (paese destinazione transazione principale).

---

### 3.4 Nuovo Risk Element Online: SAR Occasional *(solo CZ/SK, solo Occasional)*

**Non presente in Austria.** CZ/SK introduce una versione specifica di SAR per clienti occasionali nel modello online:

| Risk Element | Instances | Segmento |
|---|---|---|
| `sar_sent_to_fiu_occasional` | `>= 2 cases closed with status SAR` | Occasional customers Individual |
| `sar_sent_to_fiu_occasional` | `1 case closed with status SAR` | Occasional customers Individual |
| `sar_sent_to_fiu_occasional` | `n` | Occasional customers Individual |

**Cosa implementare:** Aggiungere il risk element `sar_sent_to_fiu_occasional` al modello online CZ/SK. Differisce dal `sar_sent_to_fiu` standard perché valuta il numero di casi chiusi con status SAR (non solo presenza/assenza) ed è riservato al segmento Occasional.

---

### 3.5 Source of Funds Online: Segmento Occasional e FIBS

**Austria batch:** SoF instances per Retail: Applicable. Per Corporate/CIB/FIBS: Applicable.

**CZ/SK online:**
- SoF instances per Retail/PB Individual/Occasional Individual: Applicable (inheritance, real estate, savings, stock, employment)
- SoF instances per Corporate (no CIB)/CIB: Solo FIBS (no Corr. Banks) per le istanze `extraordinary_sources`, `business_revenues`, `capital_increase`, `loans`
- `source_of_funds.origin_from_high_risk_country`: Solo PB&WM Individual (non Retail)

**Cosa implementare:** Configurare la SoF del modello online CZ/SK per includere il segmento Occasional Individual (con le istanze standard) e limitare le SoF per corporate a FIBS escludendo Corr. Banks.

---

## 4. Regole di Automatic KYC Review: Differenze CZ/SK vs Austria

### 4.1 Finestra temporale di pre-verifica

| | Austria | CZ/SK |
|---|---|---|
| Giorni prima della scadenza KYC | **100 giorni** | **90 giorni** |

**Cosa implementare:** Configurare la finestra di lookforward per l'automatic KYC review a **90 giorni** anziché 100 per le jurisdiction CZ e SK.

---

### 4.2 Eligibility Individuals – Differenze

| # | Regola | Austria | CZ/SK |
|---|---|---|---|
| 3 | Residenza | Residente in Austria | Residente in CZ **o** SK (secondo jurisdiction) |
| **NEW** | Cittadinanza | Non richiesta | Deve essere cittadino di CZ **o** SK (stesso paese della residenza) |
| 4 | KYC data completezza | Mandatory fields completati; ID: document number disponibile (doc può essere scaduto) | Mandatory fields completati; **SoF non può essere blank; ID: document number disponibile E documento non scaduto** |
| **NEW** | Note cliente | Non presenti | Note **W4** (cliente con richiesta da FIU) e **W23** (cliente in periodo di terminazione) escludono l'automatic review |
| 5 | Stato cliente | Cliente Attivo (ACT) | Non elencato esplicitamente come regola separata |
| 6 | Name Screening | No open NS alerts + no true positives | Solo no true positive hits (no requisito "no open NS alerts") |

**Cosa implementare per CZ/SK Individuals:**
- Aggiungere controllo su **cittadinanza** (deve essere CZ/SK) come condizione necessaria
- Rendere l'**ID non scaduto** una condizione bloccante (in Austria l'ID scaduto era permesso)
- Aggiungere controllo su **note W4 e W23**: se presenti, il cliente è escluso dall'automatic review
- Caricare da source system una tabella parametrica delle note bloccanti (almeno W4, W23; possibili espansioni future)

---

### 4.3 Eligibility Legal Persons – Differenze

| # | Regola | Austria | CZ/SK |
|---|---|---|---|
| 10 | Tipologia | Corporate con BO registry automatico; esclude CIB | **Solo** Corporate no CIB con occupation "entrepreneurs" e rel. CUST-CUST = "TIT" (nessun registry automatico disponibile) |
| 12 | Paese incorporazione | Austria | CZ o SK (per jurisdiction) |
| **NEW** | UBO non-EU | Non presente | **Il cliente non deve avere un UBO cittadino o residente in un paese non-UE** |
| **NEW** | Documentazione LR | Non presente | Legal Representatives: nessun documento scaduto |
| **NEW** | Note cliente | Non presenti | Note W4 e W23 come per le persone fisiche |
| 14 | Name Screening | No open NS alerts + no true positives (cliente + BOs) | No true positive hits su cliente e BOs (Sanctions, PEP, NN) |

**Cosa implementare per CZ/SK Legal Persons:**
- Il perimetro è più ristretto: solo "entrepreneurs" con relazione TIT
- Aggiungere controllo su UBO non-EU (cittadinanza e residenza dei BOs)
- Aggiungere controllo sulla scadenza documenti dei Legal Representatives
- Stesse note W4/W23 degli Individual

---

## 5. Gestione del KYC Review Date e AML Block: Differenze

### 5.1 Risk Rating Increase → Ad-Hoc Review

| Evento | Austria | CZ/SK |
|---|---|---|
| Rating sale da low→medium, low→high, medium→high | Ad-hoc review + KYC date = D+60 (se data corrente > D+60) | Identico, con esplicitazione: "date shall not be changed if current expiry date is less than 60 days" |
| Rating sale a High Risk Unwanted | AML Block; nessun cambio data KYC; nessun ad-hoc review | AML Block; nessun cambio data KYC; **KYC status "Due diligence not valid/not completed"** inviato al front-end |
| Rating scende | Nessun cambio data KYC; rimozione blocco comunicata al front-end | Identico, **+ invio istruzione rimozione blocco** al sistema locale |
| **NEW** Notifica email | Generica | **Standardizzata** con opzione per la local application di creare task dalla mail ricevuta |

**Cosa implementare:**
- Aggiungere KYC status `"Due diligence not valid/not completed"` nel backfeeding quando il rating sale a High-Risk Unwanted
- La notifica email di ad-hoc review deve essere strutturata per permettere la creazione di task nel sistema locale

---

### 5.2 Calcolo Data Scadenza KYC (Onboarding / Online)

**Austria:** La data di scadenza KYC viene calcolata al momento del completamento del KYC Questionnaire.

**CZ/SK (TO-BE):**
- Al momento dell'onboarding, Oracle calcola il risk rating e lo invia al sistema locale **ma NON calcola la KYC expiration date** (la relazione può essere soggetta ad approvazione)
- La KYC expiration date viene calcolata **solo dopo** che Oracle riceve la data di approvazione della relazione commerciale (via chiamata online: KYC Questionnaire chiuso con esito positivo)
- Il calcolo parte dalla **data di approvazione**: 5 anni (Low), 3 anni (Medium), 1 anno (High)
- **Clienti Occasional:** nessuna KYC expiration date mai calcolata

**Cosa implementare:**
- Separare il flusso in due step per CZ/SK:
  1. Primo step: calcolo risk + invio rating/data calcolo → senza expiration date
  2. Secondo step: ricezione approval date → calcolo e invio KYC expiration date
- Gestire la logica per Re-vetting: l'expiration date originale rimane invariata fino all'approvazione della continuazione della relazione
- Gestire il flag segmento Occasional per non calcolare alcuna expiration date

---

## 6. Nuovi Trigger di Accelerated Rereview (CZ/SK vs Austria)

Austria ha già la maggior parte dei trigger. CZ/SK aggiunge:

| Trigger | Presente in Austria | Presente in CZ/SK |
|---|---|---|
| If the PEP status of a customer gets **removed** during batch feeding | ❌ Non esplicito | ✅ Sì |
| Change in the score of any related parties of Tech NDGs | ✅ Sì | Non esplicitato separatamente |
| Change in number of accounts | ✅ Sì | ✅ Sì |
| Change in number of account delegates | ✅ Sì | ✅ Sì |

**Cosa implementare:**
- Aggiungere trigger per la **rimozione dello status PEP** (PEP declassification): deve scatenare un accelerated rereview anche se il CRR score potrebbe scendere.

---

## 7. Differenze nei Risk Element per Segmento: Sintesi Tabellare

La tabella seguente sintetizza le principali differenze di applicabilità dei risk element tra Austria (batch) e CZ/SK (batch):

| Risk Element | Risk Instance | Austria (batch) | CZ/SK (batch) |
|---|---|---|---|
| `central_banks_in_low_jurisdictions` | y/n | FIBS | FIBS solo (esclusi Corporate e CIB) |
| `branch_subsidiary_in_sanctioned_country` | tutte | **Non esiste** | Corporate, CIB, FIBS (nuovo) |
| `geography.*` | `fatf_black_grey_country_no_eu` | **Non esiste** | Applicable (Local specific) |
| `geography.*` | `fatf_black_grey_country_eu` | **Non esiste** | Applicable (Local specific) |
| `related_parties` | `ubo_authorized_signatory_*_fatf_grey_black_no_EU` | **Non esiste** | Corporate, CIB, FIBS (Local specific) |
| `related_parties` | `ubo_authorized_signatory_*_fatf_grey_black_EU` | **Non esiste** | Corporate, CIB, FIBS (Local specific) |
| `products.*` | tutti | Applicable (vari segmenti) | Applicable (batch) / **Not applicable** (online) |
| `cash_trx` | threshold 1/2/3 | Applicable (batch) | Applicable (batch) / **Not applicable** (online) |
| `source_of_wealth.*` | SoW instances | Applicable | Applicable (batch) / only EDD (online) |
| `country_of_destination_of_transaction` | domestic | **Non esiste** | Occasional Individual (online, nuovo) |
| `sar_sent_to_fiu_occasional` | >=2, 1, n | **Non esiste** | Occasional Individual (online, nuovo) |

---

## 8. Riepilogo Implementativo

| # | Cosa implementare | Priorità |
|---|---|---|
| 1 | Nuovi segmenti: Occasional customers Individual e LP per CZ/SK | Alta |
| 2 | Logica "no KYC expiration date" per segmento Occasional | Alta |
| 3 | Risk element `branch_subsidiary_in_sanctioned_country` (batch, CZ/SK) | Alta |
| 4 | Risk instances FATF granulari (`fatf_black_grey_country_no_eu`, `_eu`) su tutti i geography elements | Alta |
| 5 | Risk instances Related Parties locali (UBO/authorized signatory FATF) | Alta |
| 6 | Modello online CZ/SK: rimuovere prodotti, cash trx, trx con paesi HR | Alta |
| 7 | Modello online CZ/SK: SoW in "only EDD" mode | Media |
| 8 | Risk element `country_of_destination_of_transaction` (online, Occasional) | Media |
| 9 | Risk element `sar_sent_to_fiu_occasional` (online, Occasional) | Media |
| 10 | Automatic review: finestra 90 giorni (non 100) per CZ/SK | Alta |
| 11 | Automatic review Individuals: aggiungere controllo cittadinanza CZ/SK | Alta |
| 12 | Automatic review Individuals: ID scaduto = bloccante (Austria: consentito) | Alta |
| 13 | Automatic review: note W4 e W23 come esclusioni (tabella parametrica) | Alta |
| 14 | Automatic review Legal Persons: solo "entrepreneurs" con rel. TIT | Alta |
| 15 | Automatic review Legal Persons: controllo UBO non-EU | Media |
| 16 | Automatic review Legal Persons: controllo documenti Legal Representatives | Media |
| 17 | Calcolo KYC expiration date in due step (onboarding CZ/SK) | Alta |
| 18 | Backfeeding: KYC status "Due diligence not valid/not completed" per High Unwanted | Media |
| 19 | Email notifica ad-hoc review: strutturata con opzione task creation | Bassa |
| 20 | Accelerated rereview trigger: rimozione PEP status | Media |
| 21 | Auto-Low Central Banks: limitare a solo FIBS in CZ/SK (escludere Corporate/CIB) | Alta |

---

## 9. Domande Aperte / Open Questions

1. **Technical NDGs per CZ/SK**: I documenti TO-BE non descrivono la gestione dei Technical NDGs (Joint Headings, Trust, Numbered Accounts) per CZ e SK. La logica di risk propagation è identica all'Austria o cambia?

2. **Score dei nuovi risk elements**: Per `branch_subsidiary_in_sanctioned_country`, le due nuove instances FATF geografiche e le Related Parties locali, qual è il punteggio di rischio configurato? I documenti forniti non includono i valori di score.

3. **Note parametriche W4/W23**: Oltre a W4 e W23, verranno aggiunte altre note bloccanti? Dove è definita la lista completa?

4. **Modello Online – segmento Occasional LP**: Il documento specifica regole per Occasional Individual nell'online, ma le istanze per Occasional LP nell'online risultano tutte "Not applicable". Confermare che il segmento LP occasional non ha scoring online.

5. **Re-vetting**: Il flusso di re-vetting online (review di cliente esistente tramite KYC Questionnaire) deve mantenere la data scadenza originale fino all'approvazione — questo è tecnicamente diverso dall'onboarding. Come viene identificato tecnicamente il tipo di chiamata (onboarding vs re-vetting)?

6. **AML Block architecture**: In Austria il blocco viene gestito tramite backfeeding Oracle (set status 46). In CZ/SK si dice "block setting will be managed by the local application based on Oracle's CRR instruction". Qual è l'esatto meccanismo di istruzione inviato da Oracle al sistema locale CZ/SK?

7. **Criteri di automatic review – "Active Client"**: In Austria è un requisito esplicito. Per CZ/SK il documento non lo menziona. È un'omissione o non è più richiesto?
