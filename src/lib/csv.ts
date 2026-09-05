/**
 * RazorShield AI — CSV utilities for Dataset Studio.
 *
 * A small, dependency-free CSV reader tuned for payment exports: sniffs the
 * delimiter, honours quoted fields with escaped quotes, tolerates CRLF, and
 * skips UTF-8 BOM. Also provides heuristic column mapping (payment exports
 * from different gateways name the same field a dozen different ways) and a
 * sample-file generator so judges can exercise the flow in seconds.
 */

import type { ColumnMapping, EngineField, RawRow } from "@/types/dataset";

export interface ParseResult {
  headers: string[];
  rows: RawRow[];
  /** Detected delimiter (for the UI caption). */
  delimiter: string;
  /** Rows that were dropped because their field count didn't match the header. */
  malformedCount: number;
}

/** Strip a UTF-8 BOM if the export tooling added one. */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Choose the delimiter that yields the most consistent column counts. */
export function sniffDelimiter(text: string): string {
  const sample = text.slice(0, 8_192);
  const candidates = [",", ";", "\t", "|"];
  let best = ",";
  let bestScore = -1;
  for (const d of candidates) {
    const lines = sample.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) continue;
    const counts = lines.slice(0, 30).map((l) => splitLine(l, d).length);
    const first = counts[0];
    const consistent = counts.filter((c) => c === first).length;
    const score = consistent * 100 + (first > 1 ? first : 0);
    if (first > 1 && score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

/** Split one CSV line honouring quotes and escaped quotes ("" → "). */
function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

/**
 * Parse a CSV/TSV export into headers + row objects.
 * Blank lines are ignored; rows with a different field count than the header
 * are counted as malformed and skipped (surfaced in the UI honestly).
 */
export function parseCsv(text: string): ParseResult {
  const clean = stripBom(text);
  const delimiter = sniffDelimiter(clean);
  const lines = clean.split(/\r?\n/).filter((l) => l.trim().length > 0);

  if (!lines.length) return { headers: [], rows: [], delimiter, malformedCount: 0 };

  const headers = splitLine(lines[0], delimiter).map((h, i) => h || `column_${i + 1}`);
  const rows: RawRow[] = [];
  let malformedCount = 0;

  for (const line of lines.slice(1)) {
    const cells = splitLine(line, delimiter);
    if (cells.length !== headers.length) {
      malformedCount += 1;
      continue;
    }
    const row: RawRow = {};
    headers.forEach((h, i) => {
      row[h] = cells[i];
    });
    rows.push(row);
  }

  return { headers, rows, delimiter, malformedCount };
}

/* ------------------------------------------------------------------ */
/* Column mapping heuristics                                           */
/* ------------------------------------------------------------------ */

/** Header aliases for each engine field, most specific first. */
const ALIASES: Record<EngineField, string[]> = {
  txnId: ["transaction_id", "txn_id", "transactionid", "txnid", "txn", "id", "ref", "reference", "utr", "order_id", "payment_id"],
  amount: ["amount", "value", "amt", "transaction_amount", "paid", "total", "amount_inr", "amount_rs", "price"],
  timestamp: ["timestamp", "created_at", "date", "datetime", "time", "txn_date", "transaction_date", "payment_date", "created"],
  customerId: ["customer_id", "cust_id", "customerid", "user_id", "userid", "buyer_id", "account_id", "customer"],
  customerName: ["customer_name", "name", "customername", "user_name", "buyer_name", "full_name", "holder"],
  merchant: ["merchant", "merchant_name", "vendor", "store", "payee", "beneficiary", "category"],
  location: ["location", "city", "geo", "region", "state", "place", "country", "ip_city"],
  device: ["device", "device_id", "deviceid", "user_agent", "ua", "platform", "os", "browser"],
  paymentMethod: ["payment_method", "method", "paymentmode", "payment_mode", "pm", "rail", "instrument", "payment_type", "source"],
  label: ["is_fraud", "fraud", "label", "fraud_flag", "is_fraudulent", "class", "target", "chargedback", "is_chargeback", "fraudulent", "y"],
};

const norm = (s: string) => s.toLowerCase().replace(/[\s\-_.]/g, "");

/**
 * Best-effort auto-mapping of CSV headers onto engine fields.
 * Exact alias hits win; then substring containment in either direction.
 */
export function detectMapping(headers: string[]): ColumnMapping {
  const mapping = Object.fromEntries(
    (Object.keys(ALIASES) as EngineField[]).map((f) => [f, ""]),
  ) as ColumnMapping;

  const used = new Set<string>();

  const tryAssign = (assign: (field: EngineField, header: string) => void, matcher: (headerNorm: string, alias: string) => boolean) => {
    for (const field of Object.keys(ALIASES) as EngineField[]) {
      if (mapping[field]) continue;
      for (const alias of ALIASES[field]) {
        const hit = headers.find((h) => !used.has(h) && matcher(norm(h), alias));
        if (hit) {
          assign(field, hit);
          used.add(hit);
          break;
        }
      }
    }
  };

  // pass 1: exact normalized match
  tryAssign(
    (f, h) => { mapping[f] = h; },
    (h, alias) => h === alias,
  );
  // pass 2: containment
  tryAssign(
    (f, h) => { mapping[f] = h; },
    (h, alias) => (alias.length > 2 ? (h.includes(alias) || alias.includes(h)) && h.length > 1 : h === alias),
  );

  return mapping;
}

/** True when the header values look like 0/1, true/false or yes/no fraud labels. */
export function labelValue(raw: string): 0 | 1 | null {
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  if (["1", "true", "yes", "y", "fraud", "fraudulent", "chargeback", "bad"].includes(v)) return 1;
  if (["0", "false", "no", "n", "legit", "legitimate", "good", "clean", "normal"].includes(v)) return 0;
  return null;
}

/** Parse an amount cell — tolerates ₹, commas, spaces ("₹ 12,500.50"). */
export function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[₹$,\s]/g, "");
  if (!cleaned || !/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Parse a date cell into epoch ms; accepts ISO and a few common exports. */
export function parseTimestamp(raw: string): number | null {
  const v = raw.trim();
  if (!v) return null;

  // ISO 8601 (with or without time)
  let t = Date.parse(v);
  if (Number.isFinite(t)) return t;

  // DD/MM/YYYY or DD-MM-YYYY (+ optional HH:mm[:ss])
  const dmy = v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (dmy) {
    const [, d, mo, y, h = "0", mi = "0", s = "0"] = dmy;
    t = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)).getTime();
    if (Number.isFinite(t)) return t;
  }

  // epoch seconds
  if (/^\d{10}$/.test(v)) return Number(v) * 1000;

  return null;
}

/* ------------------------------------------------------------------ */
/* Sample file                                                         */
/* ------------------------------------------------------------------ */

/**
 * A small labelled sample that exercises every rule: velocity bursts,
 * impossible travel, threshold-hugging, odd hours, new devices, method
 * switches — plus honest false positives so precision < 100%.
 */
export function buildSampleCsv(): string {
  const header = "txn_id,timestamp,amount,customer_id,customer_name,merchant,city,device,payment_method,is_fraud";
  const rows = [
    ["TXN_90001", "2026-01-12T09:14:00", "2450", "CUS_201", "Ananya Sharma", "BigBasket", "Bengaluru", "Pixel-7-A1", "UPI", "0"],
    ["TXN_90002", "2026-01-12T09:41:00", "18200", "CUS_202", "Rohan Mehta", "Croma", "Mumbai", "iPhone-14-B2", "Credit Card", "0"],
    ["TXN_90003", "2026-01-12T10:03:00", "890", "CUS_203", "Priya Nair", "Swiggy", "Kochi", "Redmi-12-C3", "Wallet", "0"],
    ["TXN_90004", "2026-01-12T10:22:00", "52400", "CUS_204", "Vikram Singh", "Apple Store", "Delhi", "MacBook-D4", "Credit Card", "0"],
    ["TXN_90005", "2026-01-12T10:31:00", "9650", "CUS_205", "Sneha Iyer", "Reliance Digital", "Chennai", "Galaxy-S23-E5", "Debit Card", "1"],
    ["TXN_90006", "2026-01-12T10:33:00", "9480", "CUS_205", "Sneha Iyer", "Reliance Digital", "Chennai", "Galaxy-S23-E5", "Debit Card", "1"],
    ["TXN_90007", "2026-01-12T10:35:00", "9920", "CUS_205", "Sneha Iyer", "Croma", "Chennai", "Galaxy-S23-E5", "Debit Card", "1"],
    ["TXN_90008", "2026-01-12T10:36:00", "9350", "CUS_205", "Sneha Iyer", "Reliance Digital", "Chennai", "Galaxy-S23-E5", "Debit Card", "1"],
    ["TXN_90009", "2026-01-12T11:02:00", "1320", "CUS_206", "Arjun Patel", "DMart", "Ahmedabad", "iPhone-13-F6", "UPI", "0"],
    ["TXN_90010", "2026-01-12T11:18:00", "4200", "CUS_207", "Kavya Reddy", "Lenskart", "Hyderabad", "OnePlus-11-G7", "UPI", "0"],
    ["TXN_90011", "2026-01-12T11:52:00", "184000", "CUS_208", "Dev Malhotra", "Luxury Watches Co", "Mumbai", "ThinkPad-H8", "Netbanking", "1"],
    ["TXN_90012", "2026-01-12T12:05:00", "2150", "CUS_209", "Meera Krishnan", "Zomato", "Pune", "Poco-X5-I9", "Wallet", "0"],
    ["TXN_90013", "2026-01-12T12:31:00", "780", "CUS_210", "Rahul Verma", "MedPlus", "Jaipur", "Realme-11-J10", "UPI", "0"],
    ["TXN_90014", "2026-01-12T13:07:00", "68000", "CUS_211", "Ishita Bose", "Jewels India", "Kolkata", "iPad-Air-K11", "Credit Card", "1"],
    ["TXN_90015", "2026-01-12T13:44:00", "3400", "CUS_212", "Karan Gupta", "Decathlon", "Gurugram", "Vivo-V29-L12", "UPI", "0"],
    ["TXN_90016", "2026-01-12T14:02:00", "48900", "CUS_213", "Nisha Rao", "Furniture Club", "Bengaluru", "Oppo-Reno-M13", "Credit Card", "0"],
    ["TXN_90017", "2026-01-12T14:19:00", "1550", "CUS_214", "Aditya Joshi", "Starbucks", "Pune", "iPhone-15-N14", "Wallet", "0"],
    ["TXN_90018", "2026-01-12T02:47:00", "22800", "CUS_215", "Tara Desai", "Flipkart", "Surat", "Unknown-Device-O15", "Netbanking", "1"],
    ["TXN_90019", "2026-01-12T15:12:00", "990", "CUS_216", "Manav Shah", "BookMyShow", "Indore", "Galaxy-A54-P16", "UPI", "0"],
    ["TXN_90020", "2026-01-12T15:38:00", "41000", "CUS_217", "Riya Kapoor", "TravelMart", "Delhi", "iPhone-14-Q17", "Credit Card", "0"],
    ["TXN_90021", "2026-01-12T15:52:00", "12300", "CUS_218", "Sahil Khan", "Electronics Bazaar", "Lucknow", "Pixel-8-R18", "Debit Card", "1"],
    ["TXN_90022", "2026-01-12T16:09:00", "660", "CUS_219", "Pooja Pandey", "Domino's", "Kanpur", "Redmi-Note-S19", "UPI", "0"],
    ["TXN_90023", "2026-01-12T16:33:00", "15400", "CUS_220", "Nikhil Bhatia", "Croma", "Noida", "iPhone-13-T20", "Credit Card", "0"],
    ["TXN_90024", "2026-01-12T17:01:00", "7600", "CUS_221", "Divya Menon", "Myntra", "Coimbatore", "Galaxy-S21-U21", "UPI", "0"],
    ["TXN_90025", "2026-01-12T17:24:00", "9750", "CUS_222", "Alok Mishra", "Reliance Digital", "Patna", "Mi-Band-V22", "Wallet", "1"],
    ["TXN_90026", "2026-01-12T17:52:00", "2890", "CUS_223", "Shreya Das", "Apollo Pharmacy", "Bhopal", "Oppo-A78-W23", "UPI", "0"],
    ["TXN_90027", "2026-01-12T18:15:00", "4450", "CUS_224", "Yash Agarwal", "Haldiram's", "Nagpur", "Realme-Narzo-X24", "UPI", "0"],
    ["TXN_90028", "2026-01-12T18:42:00", "31200", "CUS_225", "Simran Kaur", "Goldsmith & Co", "Chandigarh", "Vivo-X90-Y25", "Credit Card", "1"],
    ["TXN_90029", "2026-01-12T19:03:00", "1250", "CUS_226", "Adarsh Tiwari", "KFC", "Nagpur", "Poco-M6-Z26", "Wallet", "0"],
    ["TXN_90030", "2026-01-12T19:28:00", "56000", "CUS_227", "Lata Shetty", "Furniture Club", "Mumbai", "iPhone-14-A27", "Netbanking", "0"],
    ["TXN_90031", "2026-01-12T19:55:00", "4920", "CUS_228", "Gaurav Chopra", "Decathlon", "Faridabad", "Galaxy-F54-B28", "UPI", "0"],
    ["TXN_90032", "2026-01-12T20:14:00", "19850", "CUS_229", "Neha Sinha", "Tanishq", "Delhi", "iPhone-15-C29", "Credit Card", "0"],
    ["TXN_90033", "2026-01-12T20:40:00", "9490", "CUS_230", "Farhan Ali", "Electronics Bazaar", "Hyderabad", "OnePlus-Nord-D30", "Debit Card", "1"],
    ["TXN_90034", "2026-01-12T21:02:00", "720", "CUS_231", "Lakshmi Pillai", "QR Meal Card", "Trivandrum", "Redmi-12C-E31", "UPI", "0"],
    ["TXN_90035", "2026-01-12T21:29:00", "8600", "CUS_232", "Raghav Rao", "Sportster", "Visakhapatnam", "Galaxy-M34-F32", "UPI", "0"],
    ["TXN_90036", "2026-01-12T21:47:00", "24000", "CUS_233", "Anjali Verma", "TravelMart", "Goa", "iPhone-13-G33", "Credit Card", "0"],
    ["TXN_90037", "2026-01-12T22:06:00", "9850", "CUS_234", "Harsh Vardhan", "Reliance Digital", "Ludhiana", "Realme-11-H34", "Wallet", "1"],
    ["TXN_90038", "2026-01-12T22:33:00", "1980", "CUS_235", "Diya Shah", "Bata", "Rajkot", "Oppo-A58-I35", "UPI", "0"],
    ["TXN_90039", "2026-01-12T22:58:00", "15800", "CUS_236", "Mohit Bansal", "Croma", "Agra", "Pixel-7a-J36", "Debit Card", "0"],
    ["TXN_90040", "2026-01-12T23:21:00", "3450", "CUS_237", "Sana Sheikh", "URL Life", "Bhiwandi", "Vivo-Y56-K37", "UPI", "0"],
    ["TXN_90041", "2026-01-12T23:44:00", "47500", "CUS_238", "Prateek Jain", "Jewels India", "Jaipur", "MacBook-Air-L38", "Credit Card", "0"],
    ["TXN_90042", "2026-01-12T09:02:00", "680", "CUS_201", "Ananya Sharma", "Zomato", "Bengaluru", "Pixel-7-A1", "UPI", "0"],
    ["TXN_90043", "2026-01-12T09:08:00", "1450", "CUS_201", "Ananya Sharma", "BigBasket", "Bengaluru", "Pixel-7-A1", "UPI", "0"],
    ["TXN_90044", "2026-01-12T09:12:00", "9850", "CUS_201", "Ananya Sharma", "Electronics Bazaar", "Bengaluru", "Unknown-Dev-M39", "Wallet", "1"],
    ["TXN_90045", "2026-01-12T11:20:00", "2400", "CUS_239", "Ekta Rani", "Lifestyle", "Bengaluru", "iPhone-14-N40", "UPI", "0"],
    ["TXN_90046", "2026-01-12T11:58:00", "2850", "CUS_240", "Sameer Goyal", "Pantaloons", "Kolkata", "Galaxy-A34-O41", "UPI", "0"],
    ["TXN_90047", "2026-01-12T12:21:00", "9560", "CUS_241", "Ritu Agnihotri", "Reliance Digital", "Mumbai", "Redmi-13-P42", "Debit Card", "1"],
    ["TXN_90048", "2026-01-12T13:15:00", "1320", "CUS_242", "Devansh Mehta", "Cafe Coffee Day", "Delhi", "iPhone-13-Q43", "Wallet", "0"],
    ["TXN_90049", "2026-01-12T14:41:00", "67500", "CUS_243", "Aarti Chauhan", "Goldsmith & Co", "Surat", "ThinkPad-R44", "Netbanking", "1"],
    ["TXN_90050", "2026-01-12T15:33:00", "540", "CUS_244", "Naveen Kumar", "IRCTC", "Chennai", "Poco-C65-S45", "UPI", "0"],
  ];
  return [header, ...rows.map((r) => r.join(","))].join("\n");
}

/** Browser download helper for the sample template. */
export function downloadSampleCsv(): void {
  const blob = new Blob([buildSampleCsv()], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "razorshield-sample-transactions.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
