import type { ShippingCase } from '../types/shipping';

export const MOCK_CASES: ShippingCase[] = [
  {
    id: 'email_512',
    subject: 'SI & Draft BL Verification - MSC ZOE / V.25041',
    sender: 'operations@msc-logistics.com',
    timestamp: '10:35 AM',
    category: 'BL_COMPARISON',
    status: 'PASS',
    statusNote: 'All 7 key verification fields match source document with 100% precision.',
    vessel: 'MSC ZOE',
    voyageNumber: '25041',
    pol: 'SHANGHAI, CN',
    pod: 'DUBAI, AE',
    fields: [
      { key: 'shipper', label: 'Shipper', siValue: 'Apex Logistics Ltd.', blValue: 'Apex Logistics Ltd.', match: true, status: 'match' },
      { key: 'consignee', label: 'Consignee', siValue: 'Orient Shipping LLC', blValue: 'Orient Shipping LLC', match: true, status: 'match' },
      { key: 'notify_party', label: 'Notify Party', siValue: 'Same as Consignee', blValue: 'Same as Consignee', match: true, status: 'match' },
      { key: 'pol', label: 'Port of Loading', siValue: 'SHANGHAI, CN', blValue: 'SHANGHAI, CN', match: true, status: 'match' },
      { key: 'pod', label: 'Port of Discharge', siValue: 'DUBAI, AE', blValue: 'DUBAI, AE', match: true, status: 'match' },
      { key: 'vessel', label: 'Vessel / Voyage', siValue: 'MSC ZOE / 25041', blValue: 'MSC ZOE / 25041', match: true, status: 'match' },
      { key: 'container_id', label: 'Container ID', siValue: 'MSCU7829104', blValue: 'MSCU7829104', match: true, status: 'match' },
      { key: 'gross_weight', label: 'Gross Weight', siValue: '28,450 KG', blValue: '28,450 KG', match: true, status: 'match' }
    ],
    aiAnalysis: {
      confidence: 99.4,
      summary: 'Verification complete. Zero discrepancies detected. Both documents are in full compliance with MSC standard bill of lading specifications.',
      recommendation: 'Auto-approval safe. Document is clean and ready for carrier submission.',
      carrierRule: 'MSC Rule #B-402: Clean bill of lading requirement satisfied.',
      model: 'Gemini 3 Flash'
    },
    auditTrail: [
      { time: '10:35:12 AM', action: 'Email ingested and attachments extracted (pypdfium2)', actor: 'Ingestion Engine' },
      { time: '10:35:14 AM', action: 'RapidOCR scanned text extraction complete (100% confidence)', actor: 'RapidOCR Engine' },
      { time: '10:35:15 AM', action: 'La Peace Multi-Agent comparison: Status marked PASS', actor: 'La Peace Copilot' }
    ]
  },
  {
    id: 'email_004',
    subject: 'Draft BL Review - COSCO PRIDE / V.049W',
    sender: 'forwarder-desk@cosco-agency.com',
    timestamp: '11:15 AM',
    category: 'BL_COMPARISON',
    status: 'MISMATCH',
    statusNote: 'Discrepancy detected: Gross weight variance exceeds 0.2% tolerance (1.1% delta).',
    vessel: 'COSCO PRIDE',
    voyageNumber: '049W',
    pol: 'NHAVA SHEVA, IN',
    pod: 'TUTICORIN, IN',
    fields: [
      { key: 'shipper', label: 'Shipper', siValue: 'FastForward Logistics Ltd.', blValue: 'FastForward Logistics Ltd.', match: true, status: 'match' },
      { key: 'consignee', label: 'Consignee', siValue: 'Al Gurg Building Materials LLC', blValue: 'Al Gurg Building Materials LLC', match: true, status: 'match' },
      { key: 'notify_party', label: 'Notify Party', siValue: 'Al Gurg Logistics Dept.', blValue: 'To Order of Shipper', match: false, varianceNote: 'SI specifies named department; BL specifies To Order', status: 'mismatch' },
      { key: 'pol', label: 'Port of Loading', siValue: 'NHAVA SHEVA, IN', blValue: 'NHAVA SHEVA, IN', match: true, status: 'match' },
      { key: 'pod', label: 'Port of Discharge', siValue: 'TUTICORIN, IN', blValue: 'TUTICORIN, IN', match: true, status: 'match' },
      { key: 'vessel', label: 'Vessel / Voyage', siValue: 'COSCO PRIDE / 049W', blValue: 'COSCO PRIDE / 049W', match: true, status: 'match' },
      { key: 'container_id', label: 'Container ID', siValue: 'CAIU8765432', blValue: 'CAIU8765432', match: true, status: 'match' },
      { key: 'gross_weight', label: 'Gross Weight', siValue: '128,544 KG', blValue: '127,100 KG', match: false, varianceNote: '-1,444 KG delta (1.12% variance)', status: 'mismatch' }
    ],
    aiAnalysis: {
      confidence: 96.8,
      summary: 'Critical variance found on Gross Weight (128,544 KG on SI vs 127,100 KG on BL draft) and Notify Party clause. Potential customs clearance penalty.',
      recommendation: 'Do NOT approve. Send clarification email to freight forwarder requesting corrected draft BL or revised weight certificate.',
      carrierRule: 'Incoterms 2020 CFR / COSCO Cargo Rule: Weight delta must remain under ±0.20% (max 257 KG variance).',
      draftClarification: 'Dear Freight Forwarder,\n\nDuring automated verification of Case #email_004 (COSCO PRIDE / 049W), we identified discrepancies:\n1. Gross Weight: SI states 128,544 KG while Draft BL states 127,100 KG (-1,444 KG variance).\n2. Notify Party: SI specifies "Al Gurg Logistics Dept." while Draft BL states "To Order of Shipper".\n\nPlease furnish a revised draft or weight confirmation at your earliest convenience.\n\nBest regards,\nOperations Desk',
      model: 'Gemini 3 Flash'
    },
    auditTrail: [
      { time: '11:15:02 AM', action: 'Email received from forwarder-desk@cosco-agency.com', actor: 'Ingestion Engine' },
      { time: '11:15:04 AM', action: 'OCR extraction performed across PDF attachments', actor: 'RapidOCR Engine' },
      { time: '11:15:05 AM', action: 'Weight tolerance validation flagged MISMATCH (-1,444 KG)', actor: 'Verification Engine' }
    ]
  },
  {
    id: 'email_506',
    subject: 'Draft BL Confirmation - EVER GIVEN / V.102E',
    sender: 'doc-verify@evergreen-marine.com',
    timestamp: '01:40 PM',
    category: 'BL_COMPARISON',
    status: 'NEEDS_REVIEW',
    statusNote: 'Minor OCR spacing variance in Shipper entity. High likelihood of safe alias.',
    vessel: 'EVER GIVEN',
    voyageNumber: '102E',
    pol: 'TANJUNG PELEPAS, MY',
    pod: 'ROTTERDAM, NL',
    fields: [
      { key: 'shipper', label: 'Shipper', siValue: 'APRIL FAREAST PTE LTD', blValue: 'APRIL FAR EAST PTE LTD', match: false, varianceNote: 'OCR token spacing difference ("FAREAST" vs "FAR EAST")', status: 'review' },
      { key: 'consignee', label: 'Consignee', siValue: 'EuroLogistics BV', blValue: 'EuroLogistics BV', match: true, status: 'match' },
      { key: 'notify_party', label: 'Notify Party', siValue: 'Same as Consignee', blValue: 'Same as Consignee', match: true, status: 'match' },
      { key: 'pol', label: 'Port of Loading', siValue: 'TANJUNG PELEPAS, MY', blValue: 'TANJUNG PELEPAS, MY', match: true, status: 'match' },
      { key: 'pod', label: 'Port of Discharge', siValue: 'ROTTERDAM, NL', blValue: 'ROTTERDAM, NL', match: true, status: 'match' },
      { key: 'vessel', label: 'Vessel / Voyage', siValue: 'EVER GIVEN / 102E', blValue: 'EVER GIVEN / 102E', match: true, status: 'match' },
      { key: 'container_id', label: 'Container ID', siValue: 'EMCU9928172', blValue: 'EMCU9928172', match: true, status: 'match' },
      { key: 'gross_weight', label: 'Gross Weight', siValue: '45,200 KG', blValue: '45,200 KG', match: true, status: 'match' }
    ],
    aiAnalysis: {
      confidence: 94.2,
      summary: 'Entity recognition identifies "APRIL FAREAST" and "APRIL FAR EAST" as identical legal corporate entities under Singapore ACRA registration. All other 6 critical logistics fields match identically.',
      recommendation: 'Recommended action: One-click "Approve as Alias" to resolve.',
      carrierRule: 'RAG Carrier Precedent: Evergreen accepting documented registered legal aliases.',
      model: 'Gemini 3 Flash'
    },
    auditTrail: [
      { time: '01:40:11 PM', action: 'Ingested email_506 with 2 scanned attachments', actor: 'Ingestion Engine' },
      { time: '01:40:14 PM', action: 'RapidOCR processed rotated scanned image', actor: 'RapidOCR Engine' },
      { time: '01:40:15 PM', action: 'RAG Entity Resolver identified subsidiary match (98% confidence)', actor: 'La Peace Copilot' }
    ]
  },
  {
    id: 'email_012',
    subject: 'Urgent: Detention & Demurrage Tariff Inquiry',
    sender: 'procurement@globaltraders.org',
    timestamp: '02:05 PM',
    category: 'INVOICE_QUERY',
    status: 'INQUIRY',
    statusNote: 'Non-verification inquiry email automatically routed to tariff knowledgebase.',
    vessel: 'N/A',
    voyageNumber: 'N/A',
    pol: 'N/A',
    pod: 'N/A',
    fields: [],
    aiAnalysis: {
      confidence: 98.1,
      summary: 'Email does not contain Bill of Lading or Shipping Instruction attachments. It is a tariff inquiry requesting Port Klang free-time limits.',
      recommendation: 'Routed to general tariff RAG system. No document comparison required.',
      model: 'Gemini 3 Flash'
    },
    auditTrail: [
      { time: '02:05:01 PM', action: 'Email classified as INVOICE_QUERY', actor: 'Classifier Agent' }
    ]
  }
];
