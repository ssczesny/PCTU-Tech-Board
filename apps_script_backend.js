/**
 * 10W ICU Tech Board — Google Apps Script Backend
 *
 * SETUP INSTRUCTIONS:
 * 1. Open a new Google Sheet
 * 2. Go to Extensions > Apps Script
 * 3. Paste this entire file, replacing any existing code
 * 4. Click Save, then Deploy > New deployment
 *    - Type: Web app
 *    - Execute as: Me
 *    - Who has access: Anyone  (or "Anyone within [your org]" for hospital domain)
 * 5. Click Deploy, authorize when prompted, copy the Web App URL
 * 6. Paste that URL into the board HTML where it says PASTE_YOUR_SCRIPT_URL_HERE
 *
 * The script will auto-create two sheets: "rooms" and "notes"
 */

const ROOM_IDS = [
  "49","50","51","52","53","54","55","56","57","58","59","60",
  "40","41","42","43","44","45","46","47","48",
  "31","32","33","34","35","36","37","38","39"
];

function getOrCreateSheet(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
  }
  return sheet;
}

function initSheets(ss) {
  const rooms = getOrCreateSheet(ss, "rooms", ["room_id", "stocked", "stocked_at", "stocked_by"]);
  const notes = getOrCreateSheet(ss, "notes",  ["id", "ts", "by", "text", "resolved"]);

  // Seed room rows if empty
  const data = rooms.getDataRange().getValues();
  const existing = new Set(data.slice(1).map(r => String(r[0])));
  ROOM_IDS.forEach(id => {
    if (!existing.has(id)) rooms.appendRow([id, false, "", ""]);
  });

  return { rooms, notes };
}

function doGet(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const { rooms, notes } = initSheets(ss);

  const roomRows = rooms.getDataRange().getValues().slice(1);
  const roomData = {};
  roomRows.forEach(r => {
    roomData[String(r[0])] = {
      stocked: r[1] === true || r[1] === "TRUE",
      at:      r[2] ? String(r[2]) : null,
      by:      r[3] ? String(r[3]) : null
    };
  });

  const noteRows = notes.getDataRange().getValues().slice(1);
  const noteData = noteRows.map(r => ({
    id:       String(r[0]),
    ts:       String(r[1]),
    by:       String(r[2]),
    text:     String(r[3]),
    resolved: r[4] === true || r[4] === "TRUE"
  })).reverse(); // newest first

  const payload = JSON.stringify({ rooms: roomData, notes: noteData });
  return ContentService.createTextOutput(payload).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const { rooms, notes } = initSheets(ss);
  let body;
  try { body = JSON.parse(e.postData.contents); } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({ok:false,error:"bad JSON"})).setMimeType(ContentService.MimeType.JSON);
  }

  if (body.action === "toggleRoom") {
    const roomRows = rooms.getDataRange().getValues();
    for (let i = 1; i < roomRows.length; i++) {
      if (String(roomRows[i][0]) === String(body.id)) {
        const nowStocked = !roomRows[i][1] || roomRows[i][1] === "FALSE";
        rooms.getRange(i + 1, 2).setValue(nowStocked);
        rooms.getRange(i + 1, 3).setValue(nowStocked ? new Date().toISOString() : "");
        rooms.getRange(i + 1, 4).setValue(nowStocked ? (body.by || "") : "");
        break;
      }
    }
  }

  else if (body.action === "setRoom") {
    // Explicit set (used for conflict-free sync)
    const roomRows = rooms.getDataRange().getValues();
    for (let i = 1; i < roomRows.length; i++) {
      if (String(roomRows[i][0]) === String(body.id)) {
        rooms.getRange(i + 1, 2).setValue(body.stocked);
        rooms.getRange(i + 1, 3).setValue(body.stocked ? (body.at || new Date().toISOString()) : "");
        rooms.getRange(i + 1, 4).setValue(body.stocked ? (body.by || "") : "");
        break;
      }
    }
  }

  else if (body.action === "postNote") {
    const id = body.id || (Date.now().toString(36) + Math.random().toString(36).slice(2,7));
    notes.appendRow([id, body.ts || new Date().toISOString(), body.by || "", body.text || "", false]);
  }

  else if (body.action === "resolveNote") {
    const noteRows = notes.getDataRange().getValues();
    for (let i = 1; i < noteRows.length; i++) {
      if (String(noteRows[i][0]) === String(body.id)) {
        const cur = noteRows[i][4];
        notes.getRange(i + 1, 5).setValue(!(cur === true || cur === "TRUE"));
        break;
      }
    }
  }

  return ContentService.createTextOutput(JSON.stringify({ok: true})).setMimeType(ContentService.MimeType.JSON);
}
