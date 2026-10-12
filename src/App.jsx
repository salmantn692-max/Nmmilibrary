import { useState, useEffect, useMemo, useRef } from "react";
import {
  LayoutDashboard,
  Library,
  AlertTriangle,
  Search,
  Plus,
  Check,
  Clock,
  BookMarked,
  RotateCcw,
  UserPlus,
  MoreVertical,
  X,
  Layers,
  Pencil,
  ChevronRight,
  Lock,
  Camera,
  LogOut,
  Printer,
  Trash2,
  Bookmark,
} from "lucide-react";
import { BrowserMultiFormatReader } from "@zxing/library";
import JsBarcode from "jsbarcode";
import { auth, db } from "./firebaseClient";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
} from "firebase/auth";
import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  updateDoc,
  addDoc,
  query,
  where,
  getDocs,
  deleteDoc,
} from "firebase/firestore";
// Student photo uploads are disabled for now — Firebase Storage requires the
// Blaze (pay-as-you-go) billing plan. Enable it later in the Firebase Console
// (Build → Storage), then ask Claude to re-enable the photo upload feature.

const DEFAULT_CLASSES = ["CLASS-1", "CLASS-2", "CLASS-3", "CLASS-4", "CLASS-5", "CLASS-6"];

const DEFAULT_CATEGORIES = [
  "Shihab Thangal Family",
  "Women in Islamic History",
  "Mathematics",
  "Spirituality & Philosophy",
  "Human Rights & Society",
  "General Literature",
];
const UNCATEGORIZED = "Uncategorized";

// One-time migration helper: books added before categories existed (SH/HW/SM/SPY/SHR/B-prefixed
// codes from the original catalog PDF) get auto-sorted into a matching default category.
function inferCategoryFromCode(code) {
  if (/^SH\d/i.test(code)) return "Shihab Thangal Family";
  if (/^HW\d/i.test(code)) return "Women in Islamic History";
  if (/^SM\d/i.test(code)) return "Mathematics";
  if (/^SPY\d/i.test(code)) return "Spirituality & Philosophy";
  if (/^SHR\d/i.test(code)) return "Human Rights & Society";
  if (/^B\d/i.test(code)) return "General Literature";
  return "";
}

// Strips all whitespace (so "HW 9" and "HW9" are treated as the same code)
// and lowercases, for matching/searching. Storage keeps the space-stripped
// form of whatever the person typed, preserving their original casing.
function normCode(s) {
  return (s || "").replace(/\s+/g, "").toLowerCase();
}
function stripSpaces(s) {
  return (s || "").replace(/\s+/g, "");
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function addDays(dateStr, days) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
function daysBetween(a, b) {
  const d1 = new Date(a + "T00:00:00");
  const d2 = new Date(b + "T00:00:00");
  return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
}

// Scan feedback sounds — synthesized with the Web Audio API, no audio files needed.
let _audioCtx = null;
function getAudioCtx() {
  try {
    if (!_audioCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      _audioCtx = new AudioCtx();
    }
    if (_audioCtx.state === "suspended") _audioCtx.resume().catch(() => {});
    return _audioCtx;
  } catch (e) {
    return null;
  }
}
function playTone(frequency, duration, type, volume, delay) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type || "sine";
    osc.frequency.value = frequency;
    osc.connect(gain);
    gain.connect(ctx.destination);
    const start = ctx.currentTime + (delay || 0) / 1000;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume || 0.2, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration / 1000);
    osc.start(start);
    osc.stop(start + duration / 1000 + 0.03);
  } catch (e) {}
}
function playScanSound(kind) {
  if (kind === "success") {
    playTone(1047, 90, "sine", 0.22, 0); // soft "ting"
    playTone(1568, 140, "sine", 0.2, 70);
  } else if (kind === "returnSuccess") {
    playTone(784, 100, "sine", 0.2, 0); // distinct descending tone
    playTone(523, 150, "sine", 0.18, 90);
  } else if (kind === "error") {
    playTone(220, 170, "square", 0.16, 0); // short error beep
  } else if (kind === "warning") {
    playTone(440, 90, "triangle", 0.2, 0); // two-beat warning
    playTone(440, 90, "triangle", 0.2, 140);
  }
}

const SEED_BOOKS = [
  { title: "Gitanjali", author: "Rabindranath Tagore", code: "B001" },
  { title: "The Discovery of India", author: "Jawaharlal Nehru", code: "B002" },
  { title: "An Autobiography / The Story of My Experiments with Truth", author: "Mahatma Gandhi", code: "B003" },
  { title: "Godaan", author: "Munshi Premchand", code: "B004" },
  { title: "Aarogya Niketan", author: "Tarashankar Bandopadhyay", code: "B005" },
  { title: "Rashmirathi", author: "Ramdhari Singh Dinkar", code: "B006" },
  { title: "Anandamath", author: "Bankim Chandra Chatterjee", code: "B007" },
  { title: "The Guide", author: "R.K. Narayan", code: "B008" },
  { title: "Midnight's Children", author: "Salman Rushdie", code: "B009" },
  { title: "The God of Small Things", author: "Arundhati Roy", code: "B010" },
  { title: "A Fine Balance", author: "Rohinton Mistry", code: "B011" },
  { title: "The White Tiger", author: "Aravind Adiga", code: "B012" },
  { title: "Train to Pakistan", author: "Khushwant Singh", code: "B013" },
  { title: "The Great Indian Novel", author: "Shashi Tharoor", code: "B014" },
  { title: "India 2020", author: "A.P.J. Abdul Kalam", code: "B015" },
  { title: "Pather Panchali", author: "Bibhutibhushan Bandopadhyay", code: "B016" },
  { title: "Devdas", author: "Sarat Chandra Chattopadhyay", code: "B017" },
  { title: "Chemmeen", author: "Thakazhi Sivasankara Pillai", code: "B018" },
  { title: "Randamoozham", author: "M.T. Vasudevan Nair", code: "B019" },
  { title: "Khasakkinte Ithihasam", author: "O.V. Vijayan", code: "B020" },
  { title: "Aadujeevitham", author: "Benyamin", code: "B021" },
  { title: "Mrichchakatika", author: "Shudraka", code: "B022" },
  { title: "Meghaduta", author: "Kalidasa", code: "B023" },
  { title: "Arthashastra", author: "Kautilya (Chanakya)", code: "B024" },
  { title: "The Palace of Illusions", author: "Chitra Banerjee Divakaruni", code: "B025" },
].map((b) => ({ id: uid(), totalCopies: 1, availableCopies: 1, ...b }));

// Transcribed by hand from the uploaded catalog PDF (its text layer was
// corrupted by a broken font encoding, so this was read visually page by page).
const NMMI_SEED_BOOKS = [
  // SH — Shihab Thangal family / biography
  { code: "SH1", title: "വംശം ദേശം സന്ദേശം", author: "സയ്യിദ് ഹൈദരലി ശിഹാബ് തങ്ങൾ" },
  { code: "SH2", title: "മമ്പുറം തങ്ങൾ", author: "മോയിൻ ഹുദവി മലയമ്മ" },
  { code: "SH3", title: "കൊന്നാര് സയ്യിദ് മുഹമ്മദ് കോയ തങ്ങൾ", author: "മുജീബ് തങ്ങൾക്ക് കൊന്നാര്" },
  { code: "SH4", title: "സയ്യിദ് അബ്ദുറഹ്മാൻ ബാഫഖി തങ്ങൾ", author: "എംസി വടകര" },
  { code: "SH5", title: "പി എം എസ് എ പൂക്കോയ തങ്ങൾ", author: "മുജീബ് തങ്ങൾ കൊന്നാര്" },
  { code: "SH6", title: "കനിവിന്റെ സുൽത്താൻ", author: "മാലിക്ക് മഖ്ബൂൽ" },
  { code: "SH7", title: "കർമ്മവീഥിയിൽ കാൽ നൂറ്റാണ്ട്", author: "സയ്യിദ് മുഹമ്മദലി ശിഹാബ് തങ്ങൾ" },
  { code: "SH8", title: "പാണക്കാട്ടെ പച്ചത്തുരുത്ത്", author: "എം എ കരീം" },
  { code: "SH9", title: "ശിഹാബ് തങ്ങൾ മധ്യമങ്ങളിലൂടെ", author: "അഹ്മദ് ദാരിമി" },
  { code: "SH10", title: "മമ്പുറം സയ്യിദ് ഫസൽ പൂക്കോയ തങ്ങൾ", author: "കെ കെ എൻ കുറിപ്പ്" },
  { code: "SH11", title: "മമ്പുറം തങ്ങൾ കറാമത്തുകൾ", author: "സയ്യിദ് സ്വലാഹുദ്ദീൻ ബുഖാരി" },
  { code: "SH12", title: "കേരളത്തിന്റെ സ്നേഹ തേജസ്", author: "കെ പി കുഞ്ഞി മൂസ" },
  { code: "SH13", title: "നബിയും നബി കുടുംബവും", author: "അലി അസ്കർ ബാഖവി" },
  { code: "SH14", title: "കനിവിന്റെ സുൽത്താൻ", author: "കെ പി കുഞ്ഞി മൂസ" },
  { code: "SH15", title: "സയ്യിദ് അബ്ദുറഹ്മാൻ ബാഖഫി തങ്ങൾ", author: "എം സി ഇബ്രാഹിം" },
  { code: "SH16", title: "കൊന്നാര് കറാമത്ത് ചരിത്രം", author: "മുജീബ് തങ്ങൾ കൊന്നാര്" },
  { code: "SH17", title: "സെയ്ദ് ഉമറാലി ശിഹാബ് തങ്ങൾ", author: "സയ്യിദ് ഉമറലി ശിഹാബ് തങ്ങൾ" },
  { code: "SH18", title: "തങ്ങളുപ്പാപ്പ", author: "സിപി ബാസിത് ഹുദവി തിരൂർ" },
  { code: "SH19", title: "കാലം സമൂഹം", author: "സയ്യിദ് ഹൈദരലി ശിഹാബ് തങ്ങൾ" },
  { code: "SH20", title: "നബവി സുഗന്ധം ബാഅലവീ വസന്തം", author: "സയ്യിദ് ഹാഷിം ബാഅലവീ തങ്ങൾ" },
  // HW — women in Islamic history
  { code: "HW1", title: "101 സ്വഹാബി വനിതകൾ", author: "മുജീബ് റഹ്മാൻ കക്കാട്" },
  { code: "HW2", title: "മാതൃരത്നങ്ങൾ", author: "ഇബിനു മൂസ പള്ളിക്കര" },
  { code: "HW3", title: "പ്രഥമ വനിത ഖദീജ", author: "കൊടുവള്ളി അബ്ദുൽ ഖാദർ" },
  { code: "HW4", title: "ഖദീജ ബീവി", author: "അഹ്മദ് ഫൈസി" },
  { code: "HW5", title: "ഉമ്മയും മകളും", author: "മൊയ്തീൻകുട്ടി ഫൈസി" },
  { code: "HW6", title: "മഹതി ആയിഷ", author: "സ്വാലിഹ് നിസാമി" },
  { code: "HW7", title: "ഫാത്തിമ", author: "മോയിൻ മലയമ്മ" },
  { code: "HW8", title: "നന്മയുടെ ഉമ്മ റാബിയത്തുൽ അദവിയ", author: "എ എച്ച് കോട്ടപ്പുഴ" },
  { code: "HW9", title: "ബീവി സുബൈദ", author: "അഹ്മദ് ചെമ്മാട്" },
  { code: "HW10", title: "നാലു പൂക്കൾ", author: "കൊടുവള്ളി അബ്ദുൽ ഖാദർ" },
  { code: "HW11", title: "സ്വർഗ്ഗം തേടിയ ഒരു വനിതയുടെ യാത്ര", author: "സ്വഫുവാൻ സുഹൈൽ" },
  { code: "HW12", title: "ട്രൈഗ്രീസിന്റെ പുത്രി", author: "ഹുസൈൻ രണ്ടത്താണി" },
  { code: "HW13", title: "ബീവി റാബിയത്തുൽ അദബിയ", author: "അഹ്മദ് മുസ്ലിയാർ" },
  { code: "HW14", title: "ഇവൾ സൗഭാഗ്യവതി", author: "ഡോ ആയിദ് അൽകർണി" },
  { code: "HW15", title: "പർദ്ദയണിഞ്ഞ കലാകാരികൾ", author: "ഹൈദരലി ശാന്തപുരം" },
  { code: "HW16", title: "അസ്മാ ബീവി റളിയള്ളാഹു അൻഹ", author: "കെ കുഞ്ഞാമു" },
  { code: "HW17", title: "ആസിയ ബീവി", author: "പി എം കെ ഫൈസി" },
  { code: "HW18", title: "സുറാഖയുടെ മകൾ", author: "ഉസ്മാൻ നിസാമി കക്കാട്" },
  { code: "HW19", title: "നഫീസത്തുൽ മിസ്രിയ", author: "ഇല്യാസ് ചെറിയ മുണ്ടം" },
  { code: "HW20", title: "ഉമ്മു ഐമൻ", author: "കൊടുവള്ളി അബ്ദുൽ ഖാദിർ" },
  { code: "HW21", title: "സൗദ സൗഭാഗ്യം", author: "കെ വി കെ ബുഖാരി" },
  { code: "HW22", title: "ഉമ്മഹാത്തുൽ മുഅ്മിനീൻ", author: "മുഹമ്മദ് ബുഹാരി" },
  { code: "HW23", title: "നഫീസത്തുൽ മിസിരിയ", author: "മോയിൻ ഹുദവി" },
  { code: "HW24", title: "ഉമ്മുൽ മുഅമിനീൻ ആയിഷ", author: "സുലൈമാൻ നദ്വി" },
  { code: "HW25", title: "സ്വഹാബി വനിതകൾ", author: "അബ്ദുൽ കരീം" },
  { code: "HW26", title: "നിലാവൊഴുകുന്ന മരക്കാടുകൾ", author: "" },
  { code: "HW27", title: "ബീവി ഖദീജ", author: "മുജീബ് റഹ്മാൻ" },
  { code: "HW28", title: "ബീവി ആസിയ", author: "മോയിൻ" },
  { code: "HW29", title: "ഹിന്ദ്", author: "അബ്ദുൽ ഖാദിർ കൊടുവള്ളി" },
  { code: "HW30", title: "നഫീസത്തുൽ മിസിരിയ", author: "അബ്ദുൽ മജീദ്" },
  { code: "HW31", title: "ഉമ്മുകുൽസും", author: "മുജീബ് റഹ്മാൻ" },
  { code: "HW32", title: "ഫാത്തിമ", author: "അക്ബർ വഹബി" },
  { code: "HW33", title: "ഹലീമ", author: "മുഹമ്മദ്" },
  { code: "HW34", title: "ആയിഷ", author: "കൊടുവള്ളി അബ്ദുൽ ഖാദർ" },
  { code: "HW35", title: "മഹിളാ മുത്തുകൾ", author: "സ്വാദിഖ് അൻവരി" },
  { code: "HW36", title: "ബീവി ഫാത്തിമ", author: "ഫാറൂഖ് ബുഖാരി" },
  { code: "HW37", title: "മാതൃ രത്നങ്ങൾ", author: "ഇബിനു മൂസ" },
  { code: "HW38", title: "ഹാജറ ബീവി", author: "സാലിം നദ്‌വി" },
  { code: "HW39", title: "ഞാൻ ഹലീമ", author: "മുഹമ്മദ്" },
  { code: "HW40", title: "മറിയം ബീവി", author: "കൊടുവള്ളി അബ്ദുൽ ഖാദർ" },
  { code: "HW41", title: "മാതൃ രത്നങ്ങൾ", author: "വിപിനും മൂസ" },
  { code: "HW42", title: "ഫാത്തിമ", author: "കൊടുവള്ളി അബ്ദുൽ ഖാദർ" },
  { code: "HW43", title: "ആയിഷ", author: "മുഹമ്മദ് അജ്മൽ നൂറാനി" },
  { code: "HW44", title: "മാണിക്യ മലർ ബീവി ഖദീജ", author: "മുഹമ്മദ് പാറന്നൂർ" },
  { code: "HW45", title: "അസ്മാഹ് ബിൻത് അബൂബക്കർ", author: "മുഹമ്മദ് പാറന്നൂർ" },
  { code: "HW48", title: "ബീവി ഉമ്മു ഉമാറ", author: "മുഹമ്മദ് പാറന്നൂർ" },
  { code: "HW49", title: "ബീവി ഫാത്തിമ", author: "മുഹമ്മദ് ഫാറൂഖ് ബുഖാരി" },
  // SM — mathematics
  { code: "SM1", title: "കണക്കിലെ എളുപ്പവഴികൾ", author: "ടി ശിവദാസ്" },
  { code: "SM2", title: "കണ്ടുപഠിച്ചാൽ കണക്ക് എളുപ്പം", author: "മാധവൻ പള്ളത്തേരി" },
  { code: "SM3", title: "ഭാരതീയ ഗണിതം", author: "പ്രൊഫൈൽ രാമചന്ദ്രമേനോൻ" },
  { code: "SM4", title: "കുസൃതി കണക്കുകൾ", author: "എൻ ആർ രാജീവ് കുമാർ" },
  { code: "SM5", title: "മനക്കണക്ക്", author: "കെ കെ വാസു" },
  { code: "SM6", title: "ഗണിതം ലളിതം", author: "പള്ളിയറ ശ്രീധരൻ" },
  { code: "SM7", title: "കണക്ക് വരയും കുറിയും", author: "പി കെ കൊച്ചു നാരായണൻ" },
  { code: "SM8", title: "ഗണിതം എന്റെളുപ്പം", author: "എം എസ് ഖാൻ" },
  { code: "SM9", title: "ഒന്നുമില്ലായ്മയുടെ ശ്യാമ സൗന്ദര്യം", author: "ഗണിതം എന്റെളുപ്പം" },
  { code: "SM10", title: "ഗണിതം ലളിതം", author: "പള്ളിയറ ശ്രീധരൻ" },
  // SPY — spirituality / philosophy
  { code: "SPY1", title: "ജീവിത ഗാനം", author: "പി എൻ ദാസ്" },
  { code: "SPY2", title: "സത്സംഗ പിയൂഷം", author: "ബാലകൃഷ്ണൻ നായർ" },
  { code: "SPY3", title: "റൂമിയുടെ ആകാശം", author: "സൂഫി" },
  { code: "SPY4", title: "മിസ്റ്റിക് റോസ്", author: "സിദ്ധീഖ്" },
  { code: "SPY5", title: "സൂക്തി സമാഹാരം", author: "ചാക്കോ" },
  { code: "SPY6", title: "യാത്ര ബാഷ്പം", author: "സൂഫി" },
  { code: "SPY7", title: "അകക്കാഴ്ച", author: "സദ്ഗുരു" },
  { code: "SPY8", title: "ബൃഹദാരണ്യ കോപനിഷത്ത്", author: "ശിവശങ്കരൻ നായർ" },
  { code: "SPY9", title: "അഷ്ടാംഗ യോഗ", author: "നരസിംഹൻ" },
  { code: "SPY10", title: "ചാണക്യ നീതി സാരം", author: "കാമാക്ഷി കുട്ടി" },
  { code: "SPY11", title: "ആത്മവെളിച്ചം", author: "അബ്ദുൽ മജീദ്" },
  { code: "SPY12", title: "ദൈവത്തിൻറെ ചുംബനങ്ങൾ", author: "ഖലീൽ ജിബ്രാൻ" },
  { code: "SPY13", title: "മുസ്ലിമിന്റെ ഒരു ദിവസം", author: "ഇസ്മായിൽ മുജദിനി" },
  { code: "SPY14", title: "ഇസ്ലാമിക തത്വചിന്ത", author: "സിദ്ധീഖ്" },
  // SHR — human rights / social issues
  { code: "SHR1", title: "മനുഷ്യാവകാശങ്ങൾ", author: "ജി ജോ കെ മാനുവൽ" },
  { code: "SHR2", title: "വംശവൃക്ഷത്തിന്റെ വേരുകൾ", author: "സിപി അബൂബക്കർ" },
  { code: "SHR3", title: "പീഡനത്തിന് മനശാസ്ത്രം രാഷ്ട്രീയം", author: "കലിം" },
  { code: "SHR4", title: "ഭോപാലിൽ അന്ന് സംഭവിച്ചത്", author: "ഡൊമിനിക് ലാപ്പിയർ ജാവിർ മോറോ" },
  { code: "SHR5", title: "കർക്കരയേ കൊന്നതാര്", author: "മുശിരിഫ്" },
  { code: "SHR6", title: "ചരിത്രത്തിന് സംഭവിക്കുന്നത്", author: "കെ എൻ പണിക്കർ" },
  { code: "SHR7", title: "പീഡനത്തിന് എതിരെ ഒരു മാർഗ്ഗരേഖ", author: "മുഹമ്മദ് ശരീഫ്" },
  { code: "SHR8", title: "ഇരകളുടെ മാനിഫെസ്റ്റോ", author: "കെ ഇ എൻ" },
  { code: "SHR9", title: "സംവരണം", author: "അബൂബക്കർ" },
  { code: "SHR10", title: "ആദിവാസി", author: "സോമൻ കടലൂർ" },
  { code: "SHR11", title: "ജലയുദ്ധങ്ങൾ", author: "വന്ദന ശിവ" },
  { code: "SHR12", title: "സുഭാഷ് ചന്ദ്രബോസിന്റെ തിരോധാനം", author: "പി എസ് രാകേഷ്" },
  { code: "SHR13", title: "ഫലസ്തീൻ", author: "ആലിക്കുട്ടി മുസ്ലിയാർ" },
  { code: "SHR14", title: "മനുഷ്യാവകാശ സാമ്രാജ്യത്വം ഭീകരത", author: "തഫ്സൽ ഇജാസ്" },
  { code: "SHR15", title: "പാരിസ്ഥിതിയും സോഷ്യലിസവും", author: "ക്രിസ് വില്യംസ്" },
  { code: "SHR16", title: "ബാബരി മസ്ജിദ് രാമജന്മഭൂമിയോ", author: "ഹാരിസ്" },
  { code: "SHR17", title: "ബാബരി മസ്ജിദിന്റെ പതനവും മതേതര പ്രതിസന്ധിയും", author: "ഹുസൈൻ" },
  { code: "SHR18", title: "ആഗോളവൽക്കരണവും ആദിവാസികളും", author: "ഡോ മാത്യു ഐയർത്തയിൽ എസ് ജെ" },
  { code: "SHR19", title: "സാമ്രാജ്യത്തെ ഭീകരത ചരിത്ര വർത്തമാനം", author: "വിനിൻപെര ജർമ്മനി സിബ്ബുക്ക്" },
  { code: "SHR20", title: "വിദ്വേഷത്തിന്റെ വിളവെടുപ്പ്", author: "കെ എം ഷാജി" },
  { code: "SHR21", title: "കുട്ടികളുടെ അവകാശങ്ങൾ", author: "അധ്യ കാളീശ്വരം രാജ്" },
  { code: "SHR22", title: "ഗുജറാത്ത്", author: "ആർ ബി ശ്രീകുമാർ" },
  { code: "SHR23", title: "മനുഷ്യാവകാശങ്ങൾ", author: "സിജോ കെ മാനുവൽ" },
  { code: "SHR24", title: "മനുഷ്യാവകാശ പ്രവർത്തകർക്ക്", author: "അധ്യ എം എം അലിയാർ" },
  { code: "SHR25", title: "പാരിസ്ഥിതിക പരിപ്രേക്ഷ്യം", author: "എ എൻ സത്യദാസ്" },
  { code: "SHR26", title: "സംവരണം", author: "ഡോ പി എ അബൂബക്കർ" },
  { code: "SHR27", title: "കാടുകളും ആദിവാസികളും മുളങ്കാടുകളും", author: "കെ ആർ സതീശൻ നായർ" },
  { code: "SHR28", title: "ബഹുസ്വരദയും ഇന്ത്യൻ മുസ്ലിങ്ങളും", author: "ഡോ എഫ് ആർ പരിധി" },
  { code: "SHR29", title: "ശ്രീലങ്ക", author: "ജയ്സൺ പാനികുളങ്ങര" },
  { code: "SHR30", title: "ശ്രീലങ്ക കണ്ണീരിന്റെ ഭൂപടം", author: "തോപ്പിൽ മുഹമ്മദ് ബീരാൻ" },
  { code: "SHR31", title: "മനുഷ്യാവകാശ പ്രവർത്തകർക്ക്", author: "അധ്യ എം എം അലിയാർ" },
].map((b) => ({ id: uid(), totalCopies: 1, availableCopies: 1, ...b }));

// A handful of sample students across every default class, so the list
// isn't empty on first run. Names are placeholders — edit or rename freely.
const SEED_STUDENTS = [
  { name: "ആയിഷ ഫാത്തിമ", className: "CLASS-1", roll: "D1" },
  { name: "മുഹമ്മദ് ഷാദിൽ", className: "CLASS-1", roll: "D2" },
  { name: "ഫാത്തിമ സുഹ്റ", className: "CLASS-2", roll: "D3" },
  { name: "അബ്ദുൽ ബാസിത്", className: "CLASS-2", roll: "D4" },
  { name: "ഖദീജ നസ്രിൻ", className: "CLASS-3", roll: "D5" },
  { name: "മുഹമ്മദ് ഫൈസൽ", className: "CLASS-3", roll: "D6" },
  { name: "സൈനബ റഹ്മത്ത്", className: "CLASS-4", roll: "D7" },
  { name: "യൂസുഫ് നിയാസ്", className: "CLASS-4", roll: "D8" },
  { name: "ഹാജറ സന", className: "CLASS-5", roll: "D9" },
  { name: "ഇസ്മായിൽ ഹംസ", className: "CLASS-5", roll: "D10" },
  { name: "മറിയം ഫിദ", className: "CLASS-6", roll: "D11" },
  { name: "അഹ്മദ് റാഷിദ്", className: "CLASS-6", roll: "D12" },
].map((s) => ({ id: uid(), ...s }));

function Modal({ title, onClose, children }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

function BarcodeSVG({ value }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current && value) {
      try {
        JsBarcode(ref.current, String(value), {
          format: "CODE128",
          displayValue: true,
          fontSize: 13,
          height: 42,
          margin: 6,
        });
      } catch (e) {}
    }
  }, [value]);
  if (!value) return null;
  return <svg ref={ref} className="id-barcode" />;
}

function Avatar({ name, photoUrl, size = 42, children }) {
  const initial = (name || "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <div className="avatar" style={{ width: size, height: size }}>
      {photoUrl ? (
        <img src={photoUrl} alt="" className="avatar-img" />
      ) : (
        <span className="avatar-letter" style={{ fontSize: Math.round(size * 0.42) }}>
          {initial}
        </span>
      )}
      {children}
    </div>
  );
}

function Scanner({ onResult, onClose, feedback }) {
  const videoRef = useRef(null);
  const readerRef = useRef(null);
  const [status, setStatus] = useState("starting"); // starting | scanning | error
  const [errMsg, setErrMsg] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const reader = new BrowserMultiFormatReader();
        readerRef.current = reader;
        const constraints = { video: { facingMode: { ideal: "environment" } } };
        await reader.decodeFromConstraints(constraints, videoRef.current, (result) => {
          if (!active || !result) return;
          onResult(result.getText());
        });
        if (active) setStatus("scanning");
      } catch (e) {
        if (active) {
          setStatus("error");
          setErrMsg(
            e && e.name === "NotAllowedError"
              ? "Camera permission denied."
              : e && e.message
              ? e.message
              : "Could not access the camera."
          );
        }
      }
    })();
    return () => {
      active = false;
      try {
        if (readerRef.current) readerRef.current.reset();
      } catch (e) {}
    };
  }, []);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Scan Barcode</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          <div className="scanner-video-wrap">
            <video ref={videoRef} className="scanner-video" muted playsInline />
            <div className="scanner-frame" />
            {feedback && (
              <div className={`scan-flash scan-flash-${feedback.type}`}>
                {feedback.type === "success" && <Check size={52} color="#fff" />}
                {feedback.type === "error" && <X size={52} color="#fff" />}
                {feedback.type === "warning" && <AlertTriangle size={52} color="#fff" />}
                {feedback.message && <div className="scan-flash-msg">{feedback.message}</div>}
              </div>
            )}
          </div>
          {status === "starting" && <div className="empty">Starting camera...</div>}
          {status === "error" && <div className="lock-error">{errMsg}</div>}
          <div className="lock-hint">Point the camera at the barcode on the ID card.</div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState(null);
  const [signInEmail, setSignInEmail] = useState("");
  const [signInPassword, setSignInPassword] = useState("");
  const [pwError, setPwError] = useState("");
  const [signingIn, setSigningIn] = useState(false);

  // change password
  const [changeNewPw, setChangeNewPw] = useState("");
  const [changeNewPw2, setChangeNewPw2] = useState("");
  const [changeError, setChangeError] = useState("");
  const [changeSuccess, setChangeSuccess] = useState(false);

  const [loading, setLoading] = useState(true);
  const [books, setBooks] = useState([]);
  const [students, setStudents] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [classes, setClasses] = useState(DEFAULT_CLASSES);
  const [newClassName, setNewClassName] = useState("");
  const [editingClassOld, setEditingClassOld] = useState(null);
  const [editClassName, setEditClassName] = useState("");
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [editingCategoryOld, setEditingCategoryOld] = useState(null);
  const [editCategoryName, setEditCategoryName] = useState("");

  const [selectedClass, setSelectedClass] = useState("ALL");
  const [homeQuery, setHomeQuery] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState(null);
  const [sheet, setSheet] = useState(null); // menu | issue | return | addStudent | catalog | dashboard | overdue | studentDetail | printCards
  const [detailStudentId, setDetailStudentId] = useState(null);
  const [printMode, setPrintMode] = useState("students"); // students | books
  const [printClass, setPrintClass] = useState("ALL");

  // issue sheet
  const [bookQuery, setBookQuery] = useState("");
  const [selectedBook, setSelectedBook] = useState(null);
  const [issueStudentQuery, setIssueStudentQuery] = useState("");
  const [days, setDays] = useState(14);
  const [lastIssued, setLastIssued] = useState(null);

  // return sheet
  const [returnQuery, setReturnQuery] = useState("");
  const [justReturnedId, setJustReturnedId] = useState(null);

  // catalog
  const [bookForm, setBookForm] = useState({ title: "", author: "", code: "", copies: "1", category: "" });
  const [catalogQuery, setCatalogQuery] = useState("");
  const [editingBookId, setEditingBookId] = useState(null);
  const [editBookForm, setEditBookForm] = useState({ title: "", author: "", copies: "1", category: "" });

  // add student
  const [studentForm, setStudentForm] = useState({ name: "", className: "CLASS-1", roll: "" });
  const [editingStudentId, setEditingStudentId] = useState(null);
  const [editForm, setEditForm] = useState({ name: "", className: "", roll: "" });
  const [bulkClass, setBulkClass] = useState("CLASS-1");
  const [bulkBooksText, setBulkBooksText] = useState("");
  const [bulkBookCategory, setBulkBookCategory] = useState("");
  const [bulkNames, setBulkNames] = useState("");
  const [bulkStartRoll, setBulkStartRoll] = useState("");
  const [studentListQuery, setStudentListQuery] = useState("");
  const [scannerTarget, setScannerTarget] = useState(null); // home | issueBook | issueStudent | return
  const [scanFeedback, setScanFeedback] = useState(null); // {type: "success"|"error"|"warning", message?}

  async function handleSignIn(e) {
    e.preventDefault();
    setPwError("");
    setSigningIn(true);
    try {
      await signInWithEmailAndPassword(auth, signInEmail.trim(), signInPassword);
      setSignInPassword("");
    } catch (err) {
      setPwError("Incorrect email or password.");
    }
    setSigningIn(false);
  }

  async function handleSignOut() {
    try {
      await signOut(auth);
    } catch (e) {}
  }

  async function handleChangePassword(e) {
    e.preventDefault();
    setChangeError("");
    if (!changeNewPw.trim()) {
      setChangeError("Enter a new password.");
      return;
    }
    if (changeNewPw !== changeNewPw2) {
      setChangeError("New passwords don't match.");
      return;
    }
    try {
      await updatePassword(auth.currentUser, changeNewPw);
      setChangeNewPw("");
      setChangeNewPw2("");
      setChangeSuccess(true);
    } catch (err) {
      if (err && err.code === "auth/requires-recent-login") {
        setChangeError("For security, please sign out and sign in again before changing your password.");
      } else {
        setChangeError("Couldn't update password. Try again.");
      }
    }
  }

  // Track Firebase Auth sign-in state
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
    });
    return unsub;
  }, []);

  // Subscribe to Firestore collections once signed in
  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    const unsubs = [];

    unsubs.push(
      onSnapshot(doc(db, "settings", "classes"), async (snap) => {
        const list = snap.exists() ? snap.data().list : null;
        if (Array.isArray(list) && list.length > 0) {
          setClasses(list);
        } else {
          setClasses(DEFAULT_CLASSES);
          try {
            await setDoc(doc(db, "settings", "classes"), { list: DEFAULT_CLASSES });
          } catch (e) {}
        }
      })
    );

    unsubs.push(
      onSnapshot(doc(db, "settings", "bookCategories"), async (snap) => {
        const list = snap.exists() ? snap.data().list : null;
        if (Array.isArray(list) && list.length > 0) {
          setCategories(list);
        } else {
          setCategories(DEFAULT_CATEGORIES);
          try {
            await setDoc(doc(db, "settings", "bookCategories"), { list: DEFAULT_CATEGORIES });
          } catch (e) {}
        }
      })
    );

    unsubs.push(
      onSnapshot(collection(db, "books"), async (qsnap) => {
        if (qsnap.empty) {
          const allSeed = [...SEED_BOOKS, ...NMMI_SEED_BOOKS];
          for (const b of allSeed) {
            try {
              await setDoc(doc(db, "books", b.code), {
                title: b.title,
                author: b.author,
                code: b.code,
                totalCopies: 1,
                availableCopies: 1,
                category: inferCategoryFromCode(b.code) || "",
              });
            } catch (e) {}
          }
        } else {
          setBooks(qsnap.docs.map((d) => ({ id: d.id, ...d.data() })));
          // One-time migration: give books added before categories existed a sensible
          // default category, inferred from their code prefix. Harmless no-op once done.
          for (const d of qsnap.docs) {
            const data = d.data();
            if (!data.category) {
              const inferred = inferCategoryFromCode(d.id);
              if (inferred) {
                try {
                  await updateDoc(doc(db, "books", d.id), { category: inferred });
                } catch (e) {}
              }
            }
          }
        }
      })
    );

    unsubs.push(
      onSnapshot(collection(db, "students"), async (qsnap) => {
        if (qsnap.empty) {
          for (const s of SEED_STUDENTS) {
            try {
              await addDoc(collection(db, "students"), { name: s.name, className: s.className, roll: s.roll });
            } catch (e) {}
          }
        } else {
          setStudents(qsnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        }
      })
    );

    unsubs.push(
      onSnapshot(collection(db, "transactions"), (qsnap) => {
        setTransactions(qsnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      })
    );

    setLoading(false);
    return () => unsubs.forEach((u) => u && u());
  }, [user]);

  const activeTx = useMemo(() => transactions.filter((t) => !t.returnDate), [transactions]);
  const overdueTx = useMemo(() => activeTx.filter((t) => t.dueDate < todayISO()), [activeTx]);
  const totalCopies = useMemo(() => books.reduce((s, b) => s + b.totalCopies, 0), [books]);
  const availableCopies = useMemo(() => books.reduce((s, b) => s + b.availableCopies, 0), [books]);

  function bookById(id) {
    return books.find((b) => b.id === id);
  }
  function studentById(id) {
    return students.find((s) => s.id === id);
  }
  function studentActiveTx(id) {
    return activeTx.filter((t) => t.studentId === id);
  }
  function studentHasOverdue(id) {
    return overdueTx.some((t) => t.studentId === id);
  }

  async function addClass(e) {
    e.preventDefault();
    const name = newClassName.trim();
    if (!name) return;
    if (classes.some((c) => c.toLowerCase() === name.toLowerCase())) {
      setNewClassName("");
      return;
    }
    const updated = [...classes, name];
    try {
      await setDoc(doc(db, "settings", "classes"), { list: updated });
    } catch (e) {}
    setNewClassName("");
  }

  function startEditClass(name) {
    setEditingClassOld(name);
    setEditClassName(name);
  }
  function cancelEditClass() {
    setEditingClassOld(null);
  }

  async function saveEditClass(e) {
    e.preventDefault();
    const oldName = editingClassOld;
    const newName = editClassName.trim();
    if (!newName || newName === oldName) {
      setEditingClassOld(null);
      return;
    }
    if (classes.some((c) => c !== oldName && c.toLowerCase() === newName.toLowerCase())) {
      return; // duplicate name
    }
    const updatedList = classes.map((c) => (c === oldName ? newName : c));
    try {
      await setDoc(doc(db, "settings", "classes"), { list: updatedList });
      const q = query(collection(db, "students"), where("className", "==", oldName));
      const snap = await getDocs(q);
      for (const d of snap.docs) {
        try {
          await updateDoc(doc(db, "students", d.id), { className: newName });
        } catch (e2) {}
      }
    } catch (e) {}
    setEditingClassOld(null);
  }

  async function deleteClass(name) {
    const count = students.filter((s) => s.className === name).length;
    const msg =
      count > 0
        ? `${count} student(s) are in "${name}". Remove the class anyway? (their records keep "${name}" as a class, but it'll stop showing as a filter chip)`
        : `Remove class "${name}"?`;
    if (!window.confirm(msg)) return;
    const updatedList = classes.filter((c) => c !== name);
    try {
      await setDoc(doc(db, "settings", "classes"), { list: updatedList });
    } catch (e) {}
  }

  async function addCategory(e) {
    e.preventDefault();
    const name = newCategoryName.trim();
    if (!name) return;
    if (categories.some((c) => c.toLowerCase() === name.toLowerCase())) {
      setNewCategoryName("");
      return;
    }
    const updated = [...categories, name];
    try {
      await setDoc(doc(db, "settings", "bookCategories"), { list: updated });
    } catch (e) {}
    setNewCategoryName("");
  }

  function startEditCategory(name) {
    setEditingCategoryOld(name);
    setEditCategoryName(name);
  }
  function cancelEditCategory() {
    setEditingCategoryOld(null);
  }

  async function saveEditCategory(e) {
    e.preventDefault();
    const oldName = editingCategoryOld;
    const newName = editCategoryName.trim();
    if (!newName || newName === oldName) {
      setEditingCategoryOld(null);
      return;
    }
    if (categories.some((c) => c !== oldName && c.toLowerCase() === newName.toLowerCase())) {
      return;
    }
    const updatedList = categories.map((c) => (c === oldName ? newName : c));
    try {
      await setDoc(doc(db, "settings", "bookCategories"), { list: updatedList });
      const q = query(collection(db, "books"), where("category", "==", oldName));
      const snap = await getDocs(q);
      for (const d of snap.docs) {
        try {
          await updateDoc(doc(db, "books", d.id), { category: newName });
        } catch (e2) {}
      }
    } catch (e) {}
    setEditingCategoryOld(null);
  }

  async function deleteCategory(name) {
    const count = books.filter((b) => b.category === name).length;
    const msg =
      count > 0
        ? `${count} book(s) are in "${name}". Remove the category anyway? (those books move to Uncategorized)`
        : `Remove category "${name}"?`;
    if (!window.confirm(msg)) return;
    const updatedList = categories.filter((c) => c !== name);
    try {
      await setDoc(doc(db, "settings", "bookCategories"), { list: updatedList });
      const q = query(collection(db, "books"), where("category", "==", name));
      const snap = await getDocs(q);
      for (const d of snap.docs) {
        try {
          await updateDoc(doc(db, "books", d.id), { category: "" });
        } catch (e2) {}
      }
    } catch (e) {}
  }

  async function addBook(e) {
    e.preventDefault();
    if (!bookForm.title.trim() || !bookForm.code.trim()) return;
    const copies = Math.max(1, parseInt(bookForm.copies) || 1);
    const code = stripSpaces(bookForm.code);
    try {
      await setDoc(doc(db, "books", code), {
        title: bookForm.title.trim(),
        author: bookForm.author.trim(),
        code,
        totalCopies: copies,
        availableCopies: copies,
        category: bookForm.category || "",
      });
    } catch (e) {}
    setBookForm({ title: "", author: "", code: "", copies: "1", category: bookForm.category });
  }

  function startEditBook(b) {
    setEditingBookId(b.id);
    setEditBookForm({
      title: b.title,
      author: b.author || "",
      copies: String(b.totalCopies),
      category: b.category || "",
    });
  }
  function cancelEditBook() {
    setEditingBookId(null);
  }

  async function saveEditBook(e) {
    e.preventDefault();
    if (!editBookForm.title.trim()) return;
    const book = books.find((b) => b.id === editingBookId);
    if (!book) return;
    const newTotal = Math.max(1, parseInt(editBookForm.copies) || 1);
    const issuedCount = book.totalCopies - book.availableCopies;
    const newAvailable = Math.max(0, newTotal - issuedCount);
    try {
      await updateDoc(doc(db, "books", editingBookId), {
        title: editBookForm.title.trim(),
        author: editBookForm.author.trim(),
        totalCopies: newTotal,
        availableCopies: newAvailable,
        category: editBookForm.category || "",
      });
    } catch (e) {}
    setEditingBookId(null);
  }

  async function deleteBook(book) {
    const activeCount = transactions.filter((t) => t.bookId === book.id && !t.returnDate).length;
    if (activeCount > 0) {
      alert(`"${book.title}" is currently issued to ${activeCount} student(s). Get it returned first, then remove it.`);
      return;
    }
    if (!window.confirm(`Remove "${book.title}" (${book.code}) from the catalog? This can't be undone.`)) return;
    try {
      await deleteDoc(doc(db, "books", book.id));
    } catch (e) {}
  }

  async function addStudent(e) {
    e.preventDefault();
    if (!studentForm.name.trim() || !studentForm.roll.trim()) return;
    try {
      await addDoc(collection(db, "students"), {
        name: studentForm.name.trim(),
        className: studentForm.className,
        roll: studentForm.roll.trim(),
      });
    } catch (e) {}
    setStudentForm({ name: "", className: studentForm.className, roll: "" });
  }

  function startEditStudent(s) {
    setEditingStudentId(s.id);
    setEditForm({ name: s.name, className: s.className, roll: s.roll });
  }

  function cancelEditStudent() {
    setEditingStudentId(null);
  }

  async function saveEditStudent(e) {
    e.preventDefault();
    if (!editForm.name.trim() || !editForm.roll.trim()) return;
    try {
      await updateDoc(doc(db, "students", editingStudentId), {
        name: editForm.name.trim(),
        className: editForm.className,
        roll: editForm.roll.trim(),
      });
    } catch (e) {}
    setEditingStudentId(null);
  }

  async function addStudentsBulk(e) {
    e.preventDefault();
    let lines = bulkNames
      .split("\n")
      .map((n) => n.trim())
      .filter(Boolean);
    if (lines.length === 0) return;
    if (/^name\s*,/i.test(lines[0]) || /^(name|പേര്)$/i.test(lines[0])) lines = lines.slice(1);
    const startNum = parseInt(bulkStartRoll);
    const hasStart = !isNaN(startNum);
    let autoIdx = 0;
    for (const line of lines) {
      const parts = line.split(",").map((p) => p.trim());
      const name = parts[0];
      if (!name) continue;
      const className = parts[1] || bulkClass;
      const roll = parts[2] || (hasStart ? String(startNum + autoIdx) : "");
      autoIdx++;
      try {
        await addDoc(collection(db, "students"), { name, className, roll });
      } catch (e) {}
    }
    setBulkNames("");
    setBulkStartRoll("");
  }

  async function addBooksBulk(e) {
    e.preventDefault();
    let lines = bulkBooksText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) return;
    if (/^code\s*,/i.test(lines[0])) lines = lines.slice(1);
    for (const line of lines) {
      const parts = line.split(",").map((p) => p.trim());
      const code = stripSpaces(parts[0]);
      const title = parts[1];
      if (!code || !title) continue;
      const author = parts[2] || "";
      const copies = Math.max(1, parseInt(parts[3]) || 1);
      const category = parts[4] || bulkBookCategory || "";
      try {
        await setDoc(doc(db, "books", code), {
          title,
          author,
          code,
          totalCopies: copies,
          availableCopies: copies,
          category,
        });
      } catch (e) {}
    }
    setBulkBooksText("");
  }

  async function issueBook() {
    const studentId = selectedStudentId;
    if (!studentId || !selectedBook) return;
    if (selectedBook.availableCopies < 1) return;
    const issueDate = todayISO();
    const dueDate = addDays(issueDate, Math.max(1, parseInt(days) || 14));
    try {
      await addDoc(collection(db, "transactions"), {
        bookId: selectedBook.id,
        studentId,
        issueDate,
        dueDate,
        returnDate: null,
      });
      await updateDoc(doc(db, "books", selectedBook.id), {
        availableCopies: selectedBook.availableCopies - 1,
      });
    } catch (e) {}
    const st = studentById(studentId);
    setLastIssued({ bookTitle: selectedBook.title, studentName: st ? st.name : "", dueDate });
    setSelectedBook(null);
    setBookQuery("");
  }

  async function returnBook(txId) {
    const tx = transactions.find((t) => t.id === txId);
    if (!tx) return;
    const book = bookById(tx.bookId);
    try {
      await updateDoc(doc(db, "transactions", txId), { returnDate: todayISO() });
      if (book) {
        await updateDoc(doc(db, "books", tx.bookId), {
          availableCopies: Math.min(book.totalCopies, book.availableCopies + 1),
        });
      }
    } catch (e) {}
    setJustReturnedId(txId);
    setTimeout(() => setJustReturnedId((cur) => (cur === txId ? null : cur)), 1500);
  }

  const bookMatchForSearch = useMemo(() => {
    const q = normCode(homeQuery);
    if (!q) return null;
    return books.find((b) => normCode(b.code) === q || normCode(b.code).includes(q)) || null;
  }, [homeQuery, books]);

  const filteredStudents = useMemo(() => {
    let list = students;
    if (selectedClass !== "ALL") list = list.filter((s) => s.className === selectedClass);
    const q = homeQuery.trim().toLowerCase();
    if (q) {
      list = list.filter((s) => s.name.toLowerCase().includes(q) || s.roll.toLowerCase().includes(q));
    }
    return list;
  }, [students, selectedClass, homeQuery]);

  const issueBookMatches = useMemo(() => {
    const q = bookQuery.trim().toLowerCase();
    if (!q) return books.slice(0, 6);
    return books
      .filter(
        (b) =>
          b.title.toLowerCase().includes(q) ||
          b.author.toLowerCase().includes(q) ||
          normCode(b.code).includes(normCode(q))
      )
      .slice(0, 6);
  }, [bookQuery, books]);

  const issueStudentMatches = useMemo(() => {
    const q = issueStudentQuery.trim().toLowerCase();
    if (!q) return students.slice(0, 6);
    return students
      .filter((s) => s.name.toLowerCase().includes(q) || s.roll.toLowerCase().includes(q))
      .slice(0, 6);
  }, [issueStudentQuery, students]);

  const returnSearchMatches = useMemo(() => {
    const q = returnQuery.trim().toLowerCase();
    const list = activeTx
      .map((t) => ({ tx: t, book: bookById(t.bookId), student: studentById(t.studentId) }))
      .filter((r) => r.book && r.student);
    if (!q) return list.sort((a, b) => (a.tx.dueDate < b.tx.dueDate ? -1 : 1));
    return list
      .filter(
        (r) =>
          r.book.title.toLowerCase().includes(q) ||
          r.student.name.toLowerCase().includes(q) ||
          r.book.code.toLowerCase().includes(q)
      )
      .sort((a, b) => (a.tx.dueDate < b.tx.dueDate ? -1 : 1));
  }, [returnQuery, activeTx, books, students]);

  const catalogMatches = useMemo(() => {
    const q = catalogQuery.trim().toLowerCase();
    if (!q) return books;
    return books.filter(
      (b) => b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q) || normCode(b.code).includes(normCode(q))
    );
  }, [catalogQuery, books]);

  const catalogGrouped = useMemo(() => {
    const groups = {};
    catalogMatches.forEach((b) => {
      const cat = b.category && b.category.trim() ? b.category : UNCATEGORIZED;
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(b);
    });
    const ordered = [];
    categories.forEach((c) => {
      if (groups[c]) {
        ordered.push([c, groups[c]]);
        delete groups[c];
      }
    });
    Object.keys(groups)
      .sort()
      .forEach((c) => ordered.push([c, groups[c]]));
    return ordered;
  }, [catalogMatches, categories]);

  const overdueList = useMemo(() => {
    return overdueTx
      .map((t) => ({ tx: t, book: bookById(t.bookId), student: studentById(t.studentId) }))
      .filter((r) => r.book && r.student)
      .sort((a, b) => (a.tx.dueDate < b.tx.dueDate ? -1 : 1));
  }, [overdueTx, books, students]);

  const selectedStudent = selectedStudentId ? studentById(selectedStudentId) : null;

  function openIssue() {
    setIssueStudentQuery("");
    setBookQuery("");
    setSelectedBook(null);
    setLastIssued(null);
    setSheet("issue");
  }
  function openReturn() {
    setReturnQuery("");
    setSheet("return");
  }
  function openScanner(target) {
    setScannerTarget(target);
  }

  function handleScanResult(text) {
    const val = (text || "").trim();
    let feedback = { type: "error", message: "Not found" };

    if (scannerTarget === "home") {
      const studentMatch = students.find((s) => s.roll.toLowerCase() === val.toLowerCase());
      const bookMatch = books.find((b) => normCode(b.code) === normCode(val));
      if (studentMatch) {
        feedback = { type: "success" };
        setHomeQuery("");
        openStudentDetail(studentMatch.id);
      } else if (bookMatch) {
        feedback = { type: "success" };
        setHomeQuery(val);
      } else {
        setHomeQuery(val);
      }
    } else if (scannerTarget === "issueBook") {
      setBookQuery(val);
      const match = books.find((b) => normCode(b.code) === normCode(val));
      if (match && match.availableCopies > 0) {
        setSelectedBook(match);
        feedback = { type: "success" };
      } else if (match) {
        feedback = { type: "warning", message: "Already issued" };
      }
    } else if (scannerTarget === "issueStudent") {
      setIssueStudentQuery(val);
      const match = students.find((s) => s.roll.toLowerCase() === val.toLowerCase());
      if (match) {
        setSelectedStudentId(match.id);
        feedback = { type: "success" };
      }
    } else if (scannerTarget === "return") {
      setReturnQuery(val);
      const hasMatch =
        books.some((b) => normCode(b.code) === normCode(val)) ||
        students.some(
          (s) => s.roll.toLowerCase() === val.toLowerCase() || s.name.toLowerCase().includes(val.toLowerCase())
        );
      if (hasMatch) feedback = { type: "success" };
    }

    playScanSound(feedback.type);
    setScanFeedback(feedback);
    setTimeout(
      () => {
        setScanFeedback(null);
        setScannerTarget(null);
      },
      feedback.type === "success" ? 450 : 750
    );
  }

  function openStudentDetail(id) {
    setDetailStudentId(id);
    setSheet("studentDetail");
  }
  function openAddStudent() {
    const defaultClass = selectedClass !== "ALL" ? selectedClass : classes[0] || "CLASS-1";
    setStudentForm({ name: "", className: defaultClass, roll: "" });
    setBulkClass(defaultClass);
    setBulkNames("");
    setBulkStartRoll("");
    setEditingStudentId(null);
    setStudentListQuery("");
    setSheet("addStudent");
  }

  const studentListForManage = useMemo(() => {
    const q = studentListQuery.trim().toLowerCase();
    if (!q) return students;
    return students.filter((s) => s.name.toLowerCase().includes(q) || s.roll.toLowerCase().includes(q));
  }, [students, studentListQuery]);

  return (
    <div className="app">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;800&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');

        :root {
          --navy: #163D7A;
          --maroon: #B5302A;
          --sky: #2E86DE;
          --green: #2ECC8F;
          --row-bg: #F6F3D6;
          --indigo: #3F4FC9;
          --page-bg: #FFFFFF;
          --text: #3A3A3A;
          --text-soft: #6B6B6B;
          --search-bg: #E7E7E7;
          --danger: #C0392B;
          --line: #ECEAD8;
        }
        * { box-sizing: border-box; }
        .app {
          font-family: 'Inter', sans-serif;
          background: var(--page-bg);
          color: var(--text);
          min-height: 100vh;
          max-width: 480px;
          margin: 0 auto;
          padding-bottom: 6rem;
          position: relative;
        }
        .mono { font-family: 'JetBrains Mono', monospace; }

        .top-fixed {
          position: sticky;
          top: 0;
          z-index: 20;
          background: var(--page-bg);
          padding-top: env(safe-area-inset-top, 0px);
          box-shadow: 0 2px 6px rgba(0,0,0,0.04);
        }
        .header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          padding: 1.1rem 1.1rem 0.7rem;
        }
        .brand h1 {
          font-family: 'Playfair Display', serif;
          font-weight: 800;
          font-size: 1.5rem;
          color: var(--navy);
          margin: 0;
          line-height: 1.1;
        }
        .brand .sub {
          font-size: 0.72rem;
          color: var(--maroon);
          font-weight: 500;
          margin-top: 0.15rem;
        }
        .icon-btn {
          background: transparent;
          border: none;
          color: var(--text);
          cursor: pointer;
          padding: 0.3rem;
          border-radius: 6px;
        }
        .icon-btn:hover { background: #F0F0F0; }
        .icon-btn:focus-visible { outline: 2px solid var(--indigo); outline-offset: 1px; }

        .search-wrap {
          margin: 0 1.1rem 0.8rem;
          position: relative;
        }
        .search-wrap .icon {
          position: absolute;
          left: 0.8rem;
          top: 50%;
          transform: translateY(-50%);
          color: var(--text-soft);
        }
        .search-wrap input {
          width: 100%;
          background: var(--search-bg);
          border: none;
          border-radius: 999px;
          padding: 0.7rem 0.9rem 0.7rem 2.3rem;
          font-size: 0.92rem;
          font-family: 'Inter', sans-serif;
          color: var(--text);
        }
        .search-wrap input:focus-visible { outline: 2px solid var(--indigo); }
        .search-wrap input.with-scan { padding-right: 2.7rem; }
        .scan-btn {
          position: absolute;
          right: 0.35rem;
          top: 50%;
          transform: translateY(-50%);
          background: var(--indigo);
          color: #fff;
          border: none;
          border-radius: 50%;
          width: 30px;
          height: 30px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          flex: 0 0 auto;
        }
        .scan-btn:focus-visible { outline: 2px solid var(--navy); outline-offset: 2px; }
        .scan-row { display: flex; gap: 0.5rem; align-items: stretch; }
        .scan-row input { flex: 1; min-width: 0; }
        .scan-btn-inline {
          background: var(--indigo);
          color: #fff;
          border: none;
          border-radius: 6px;
          padding: 0 0.8rem;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          flex: 0 0 auto;
        }
        .scan-btn-inline:focus-visible { outline: 2px solid var(--navy); outline-offset: 2px; }
        .scanner-video-wrap {
          position: relative;
          width: 100%;
          aspect-ratio: 3 / 4;
          background: #000;
          border-radius: 10px;
          overflow: hidden;
          margin-bottom: 0.8rem;
        }
        .scanner-video { width: 100%; height: 100%; object-fit: cover; display: block; }
        .scanner-frame {
          position: absolute;
          top: 20%;
          left: 10%;
          right: 10%;
          bottom: 30%;
          border: 3px solid var(--brass, #B8892B);
          border-radius: 10px;
          pointer-events: none;
        }

        .scan-flash {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 0.6rem;
          z-index: 5;
          animation: scanFlashPop 0.22s ease-out;
        }
        .scan-flash-success { background: rgba(31, 138, 94, 0.9); }
        .scan-flash-warning { background: rgba(217, 149, 19, 0.92); }
        .scan-flash-error { background: rgba(192, 57, 43, 0.92); }
        .scan-flash-msg {
          color: #fff;
          font-weight: 700;
          font-size: 0.92rem;
          text-align: center;
          padding: 0 1.2rem;
        }
        @keyframes scanFlashPop {
          0% { opacity: 0; transform: scale(0.92); }
          100% { opacity: 1; transform: scale(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          .scan-flash { animation: none; }
        }

        .book-hint {
          margin: -0.2rem 1.1rem 0.8rem;
          background: #EAF2FB;
          border: 1px solid #C9DFF5;
          border-radius: 8px;
          padding: 0.55rem 0.75rem;
          font-size: 0.8rem;
          color: var(--navy);
        }

        .class-row {
          display: flex;
          gap: 0.5rem;
          overflow-x: auto;
          margin: 0 1.1rem 1rem;
          padding: 0.4rem 0.5rem;
          border: 1px solid var(--line);
          border-radius: 999px;
          background: #FFFFFF;
        }
        .class-chip {
          flex: 0 0 auto;
          background: var(--sky);
          color: #fff;
          border: none;
          border-radius: 999px;
          padding: 0.45rem 0.95rem;
          font-size: 0.82rem;
          font-weight: 700;
          cursor: pointer;
          white-space: nowrap;
          opacity: 0.55;
        }
        .class-chip.active { opacity: 1; box-shadow: 0 0 0 2px #163D7A33; }
        .class-chip:focus-visible { outline: 2px solid var(--navy); outline-offset: 2px; }

        .student-list { padding: 0 1.1rem; display: flex; flex-direction: column; gap: 0.5rem; }
        .student-row {
          display: flex;
          align-items: center;
          background: var(--row-bg);
          border-radius: 10px;
          padding: 0.4rem 0.4rem 0.4rem 0.9rem;
          border: 2px solid transparent;
          width: 100%;
        }
        .student-row.selected { border-color: var(--indigo); }
        .student-row-main {
          display: flex;
          align-items: center;
          gap: 0.9rem;
          flex: 1;
          min-width: 0;
          background: none;
          border: none;
          padding: 0.4rem 0;
          margin: 0;
          cursor: pointer;
          text-align: left;
        }
        .student-row-main:focus-visible { outline: 2px solid var(--indigo); outline-offset: 2px; }
        .row-view-btn {
          background: none;
          border: none;
          color: var(--text-soft);
          cursor: pointer;
          padding: 0.5rem;
          flex: 0 0 auto;
          border-radius: 50%;
          display: flex;
        }
        .row-view-btn:hover { background: rgba(0,0,0,0.06); color: var(--navy); }
        .row-view-btn:focus-visible { outline: 2px solid var(--indigo); outline-offset: 2px; }
        .avatar {
          width: 42px;
          height: 42px;
          border-radius: 50%;
          background: var(--green);
          flex: 0 0 auto;
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
          font-weight: 700;
        }
        .avatar .dot-badge {
          position: absolute;
          top: -3px;
          right: -3px;
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: var(--danger);
          border: 2px solid #fff;
        }
        .avatar .check-badge {
          position: absolute;
          bottom: -2px;
          right: -2px;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: var(--indigo);
          display: flex;
          align-items: center;
          justify-content: center;
          border: 2px solid #fff;
        }
        .avatar-img { width: 100%; height: 100%; object-fit: cover; display: block; border-radius: 50%; }
        .avatar-letter { line-height: 1; user-select: none; }
        .student-name { font-size: 1.02rem; font-weight: 600; color: #333; }
        .student-meta { font-size: 0.76rem; color: var(--text-soft); margin-top: 0.1rem; }

        .empty {
          text-align: center;
          padding: 2.2rem 1rem;
          color: var(--text-soft);
          font-size: 0.9rem;
        }

        .bottom-bar {
          position: fixed;
          bottom: 1rem;
          left: 50%;
          transform: translateX(-50%);
          width: calc(100% - 2.2rem);
          max-width: 440px;
          background: #fff;
          border-radius: 999px;
          box-shadow: 0 6px 18px rgba(0,0,0,0.15);
          display: flex;
          justify-content: space-around;
          padding: 0.6rem 0.5rem;
        }
        .bottom-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.3rem;
          background: transparent;
          border: none;
          cursor: pointer;
          color: var(--text);
        }
        .bottom-item:focus-visible { outline: 2px solid var(--indigo); outline-offset: 2px; border-radius: 8px; }
        .bottom-dot {
          width: 34px;
          height: 34px;
          border-radius: 50%;
          background: var(--indigo);
          color: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .bottom-item .label { font-size: 0.68rem; font-weight: 700; letter-spacing: 0.02em; }

        .modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.45);
          display: flex;
          align-items: flex-end;
          justify-content: center;
          z-index: 50;
        }
        .modal-panel {
          background: #fff;
          width: 100%;
          max-width: 480px;
          max-height: 85vh;
          overflow-y: auto;
          border-radius: 16px 16px 0 0;
          padding: 1rem 1.1rem 1.4rem;
        }
        @media (min-width: 540px) {
          .modal-backdrop { align-items: center; }
          .modal-panel { border-radius: 14px; max-height: 80vh; }
        }
        .modal-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.8rem;
        }
        .modal-head h2 {
          font-family: 'Playfair Display', serif;
          font-size: 1.15rem;
          color: var(--navy);
          margin: 0;
        }

        .menu-list { display: flex; flex-direction: column; gap: 0.4rem; }
        .menu-row {
          display: flex;
          align-items: center;
          gap: 0.7rem;
          padding: 0.75rem 0.5rem;
          border-radius: 8px;
          background: #F7F7F7;
          border: none;
          cursor: pointer;
          font-size: 0.92rem;
          font-weight: 600;
          color: var(--text);
          width: 100%;
          text-align: left;
        }
        .menu-row:hover { background: #EFEFEF; }

        label { display: block; font-size: 0.8rem; color: var(--text-soft); margin-bottom: 0.3rem; }
        input[type="text"], input[type="number"], input[type="search"], select {
          width: 100%;
          font-family: 'Inter', sans-serif;
          font-size: 0.92rem;
          padding: 0.55rem 0.7rem;
          border: 1px solid #DDD;
          border-radius: 6px;
          background: #FAFAFA;
          color: var(--text);
        }
        input:focus-visible, select:focus-visible { outline: 2px solid var(--indigo); border-color: var(--indigo); }
        .field { margin-bottom: 0.7rem; }
        .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.7rem; margin-bottom: 0.7rem; }

        .btn {
          font-family: 'Inter', sans-serif;
          font-weight: 700;
          font-size: 0.9rem;
          background: var(--navy);
          color: #fff;
          border: none;
          border-radius: 8px;
          padding: 0.6rem 1.1rem;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 0.4rem;
        }
        .btn:disabled { background: #AAB1C5; cursor: not-allowed; }
        .btn:focus-visible { outline: 2px solid var(--indigo); outline-offset: 2px; }
        .btn.secondary { background: transparent; color: var(--navy); border: 1px solid var(--navy); }
        .btn.full { width: 100%; justify-content: center; }

        .pick-list { display: flex; flex-direction: column; gap: 0.4rem; margin-bottom: 0.9rem; max-height: 220px; overflow-y: auto; }
        .pick-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: #FAFAFA;
          border: 1px solid #E5E5E5;
          border-radius: 7px;
          padding: 0.55rem 0.75rem;
          cursor: pointer;
          width: 100%;
          text-align: left;
        }
        .pick-item:hover, .pick-item.selected { border-color: var(--indigo); background: #EDEEFB; }
        .pick-item .t-title { font-weight: 700; font-size: 0.88rem; }
        .pick-item .t-meta { font-size: 0.74rem; color: var(--text-soft); }
        .pick-item .badge { font-family: 'JetBrains Mono', monospace; font-size: 0.7rem; color: var(--navy); background: #E4EFFB; padding: 0.15rem 0.4rem; border-radius: 4px; }

        .current-pick {
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: #EDEEFB;
          border: 1px solid var(--indigo);
          border-radius: 7px;
          padding: 0.5rem 0.75rem;
          margin-bottom: 0.7rem;
          font-size: 0.86rem;
        }
        .current-pick button { background: none; border: none; color: var(--indigo); font-weight: 700; cursor: pointer; font-size: 0.78rem; }

        .stamp-card {
          margin-top: 1rem;
          background: #FFF;
          border: 1px dashed var(--danger);
          border-radius: 8px;
          padding: 0.9rem;
          display: flex;
          align-items: center;
          gap: 0.9rem;
        }
        .stamp-mark {
          border: 3px solid var(--danger);
          color: var(--danger);
          border-radius: 8px;
          padding: 0.45rem 0.8rem;
          transform: rotate(-6deg);
          animation: stampIn 0.35s ease-out;
          text-align: center;
          flex: 0 0 auto;
        }
        .stamp-mark .l1 { font-weight: 800; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.04em; }
        .stamp-mark .l2 { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 0.95rem; }
        @keyframes stampIn { 0% { transform: rotate(-6deg) scale(2.2); opacity: 0; } 70% { opacity: 1; } 100% { transform: rotate(-6deg) scale(1); opacity: 1; } }
        @media (prefers-reduced-motion: reduce) { .stamp-mark { animation: none; } }
        .stamp-info { font-size: 0.84rem; color: var(--text-soft); }
        .stamp-info b { color: var(--text); }

        .row-list { display: flex; flex-direction: column; gap: 0.5rem; }
        .row-card {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 0.6rem;
          background: #FAFAFA;
          border: 1px solid #E5E5E5;
          border-radius: 8px;
          padding: 0.6rem 0.8rem;
        }
        .row-card.overdue { border-color: var(--danger); background: #FBEAE8; }
        .row-card .title { font-weight: 700; font-size: 0.88rem; }
        .row-card .meta { font-size: 0.74rem; color: var(--text-soft); }
        .row-card .due { font-family: 'JetBrains Mono', monospace; font-size: 0.78rem; }
        .row-card.overdue .due { color: var(--danger); font-weight: 700; }

        .returned-flash { font-size: 0.78rem; color: #1F8A5E; font-weight: 700; display: flex; align-items: center; gap: 0.25rem; }

        table { width: 100%; border-collapse: collapse; }
        th, td { text-align: left; padding: 0.5rem 0.35rem; border-bottom: 1px solid #EEE; font-size: 0.82rem; }
        th { color: var(--text-soft); font-weight: 700; font-size: 0.72rem; }

        .grid-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 0.7rem; margin-bottom: 1rem; }
        .stat-card { background: #FAFAFA; border: 1px solid #EEE; border-top: 3px solid var(--sky); border-radius: 8px; padding: 0.75rem 0.85rem; }
        .stat-card.warn { border-top-color: var(--danger); }
        .stat-card .num { font-family: 'JetBrains Mono', monospace; font-size: 1.4rem; font-weight: 700; color: var(--navy); }
        .stat-card.warn .num { color: var(--danger); }
        .stat-card .label { font-size: 0.78rem; color: var(--text-soft); margin-top: 0.1rem; }

        .lock-screen {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 2rem 1.3rem;
          text-align: center;
        }
        .lock-icon {
          width: 56px;
          height: 56px;
          border-radius: 50%;
          background: var(--navy);
          color: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 1rem;
        }
        .lock-screen h1 {
          font-family: 'Playfair Display', serif;
          font-weight: 800;
          font-size: 1.3rem;
          color: var(--navy);
          margin: 0 0 0.15rem;
        }
        .lock-screen .sub {
          font-size: 0.74rem;
          color: var(--maroon);
          margin-bottom: 1.6rem;
        }
        .lock-form {
          width: 100%;
          max-width: 320px;
          text-align: left;
        }
        .lock-form .field { margin-bottom: 0.8rem; }
        .lock-error {
          color: var(--danger);
          font-size: 0.82rem;
          font-weight: 600;
          margin-bottom: 0.7rem;
          text-align: center;
        }
        .lock-hint {
          font-size: 0.76rem;
          color: var(--text-soft);
          margin-top: 1rem;
          text-align: center;
        }

        .print-area {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0.6rem;
        }
        .id-card {
          border: 1px solid #ccc;
          border-radius: 6px;
          padding: 0.5rem;
          text-align: center;
          background: #fff;
        }
        .id-card-name { font-weight: 700; font-size: 0.78rem; color: var(--text); }
        .id-card-meta { font-size: 0.68rem; color: var(--text-soft); margin-bottom: 0.3rem; }
        .id-barcode { width: 100%; height: auto; }

        @media print {
          body * { visibility: hidden; }
          .print-area, .print-area * { visibility: visible; }
          html, body, .app, .modal-backdrop, .modal-panel {
            position: static !important;
            overflow: visible !important;
            max-height: none !important;
            height: auto !important;
            width: 100% !important;
            background: #fff !important;
            box-shadow: none !important;
            padding: 0 !important;
            margin: 0 !important;
            border-radius: 0 !important;
            inset: auto !important;
          }
          .print-area {
            position: static !important;
            width: 100% !important;
            grid-template-columns: repeat(4, 1fr);
            page-break-inside: auto;
          }
          .id-card { break-inside: avoid; page-break-inside: avoid; }
          .no-print, .modal-head, .header, .bottom-bar, .class-row, .search-wrap, .book-hint {
            display: none !important;
          }
        }
      `}</style>

      {!authReady ? (
        <div className="empty">Loading...</div>
      ) : !user ? (
        <div className="lock-screen">
          <div className="lock-icon">
            <Lock size={26} />
          </div>
          <h1>NMMI ISLAMIC LIBRARY</h1>
          <div className="sub">Nandiyil Muhammed Musliyar Memorial Islamic Library</div>

          <form className="lock-form" onSubmit={handleSignIn}>
            <p style={{ fontSize: "0.86rem", color: "var(--text-soft)", marginBottom: "0.9rem", textAlign: "center" }}>
              Sign in with the staff account created for you in Firebase.
            </p>
            {pwError && <div className="lock-error">{pwError}</div>}
            <div className="field">
              <label>Email</label>
              <input
                type="email"
                value={signInEmail}
                onChange={(e) => setSignInEmail(e.target.value)}
                autoFocus
                required
              />
            </div>
            <div className="field">
              <label>Password</label>
              <input
                type="password"
                value={signInPassword}
                onChange={(e) => setSignInPassword(e.target.value)}
                required
              />
            </div>
            <button type="submit" className="btn full" disabled={signingIn}>
              <Lock size={15} /> {signingIn ? "Signing in..." : "Sign In"}
            </button>
            <div className="lock-hint">
              No account yet? Add one in the Firebase Console under Authentication → Users.
            </div>
          </form>
        </div>
      ) : (
        <>
      <div className="top-fixed">
        <div className="header">
          <div className="brand">
            <h1>NMMI ISLAMIC LIBRARY</h1>
            <div className="sub">Nandiyil Muhammed Musliyar Memorial Islamic Library</div>
          </div>
          <button className="icon-btn" onClick={() => setSheet("menu")} aria-label="Menu">
            <MoreVertical size={22} />
          </button>
        </div>

        <div className="search-wrap">
          <Search size={16} className="icon" />
          <input
            type="search"
            className="with-scan"
            placeholder="Search student id/ Book id"
            value={homeQuery}
            onChange={(e) => setHomeQuery(e.target.value)}
          />
          <button type="button" className="scan-btn" onClick={() => openScanner("home")} aria-label="Scan barcode">
            <Camera size={15} />
          </button>
        </div>

        <div className="class-row">
          <button className={`class-chip ${selectedClass === "ALL" ? "active" : ""}`} onClick={() => setSelectedClass("ALL")}>
            ALL
          </button>
          {classes.map((c) => (
            <button
              key={c}
              className={`class-chip ${selectedClass === c ? "active" : ""}`}
              onClick={() => setSelectedClass(c)}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {bookMatchForSearch && (
        <div className="book-hint">
          <b>{bookMatchForSearch.title}</b> ({bookMatchForSearch.code}) — {bookMatchForSearch.availableCopies}/
          {bookMatchForSearch.totalCopies} available
          {(() => {
            const holders = activeTx
              .filter((t) => t.bookId === bookMatchForSearch.id)
              .map((t) => studentById(t.studentId))
              .filter(Boolean);
            if (holders.length === 0) return null;
            return <> · with: {holders.map((h) => h.name).join(", ")}</>;
          })()}
        </div>
      )}

      {loading ? (
        <div className="empty">Loading...</div>
      ) : filteredStudents.length === 0 ? (
        <div className="empty">
          {students.length === 0
            ? "No students added yet. Use the Add Student button below to get started."
            : "No matching students."}
        </div>
      ) : (
        <div className="student-list">
          {filteredStudents.map((s) => {
            const holding = studentActiveTx(s.id).length;
            const overdue = studentHasOverdue(s.id);
            const isSelected = selectedStudentId === s.id;
            return (
              <div key={s.id} className={`student-row ${isSelected ? "selected" : ""}`}>
                <button
                  className="student-row-main"
                  onClick={() => setSelectedStudentId(isSelected ? null : s.id)}
                >
                  <Avatar name={s.name} photoUrl={s.photoUrl}>
                    {overdue && <span className="dot-badge" />}
                    {isSelected && (
                      <span className="check-badge">
                        <Check size={10} color="#fff" />
                      </span>
                    )}
                  </Avatar>
                  <div>
                    <div className="student-name">{s.name}</div>
                    <div className="student-meta">
                      {s.className} · Roll {s.roll}
                      {holding > 0 ? ` · holding ${holding}` : ""}
                    </div>
                  </div>
                </button>
                <button
                  className="row-view-btn"
                  onClick={() => openStudentDetail(s.id)}
                  aria-label={`View ${s.name}'s book history`}
                >
                  <ChevronRight size={20} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="bottom-bar">
        <button className="bottom-item" onClick={openIssue}>
          <span className="bottom-dot">
            <BookMarked size={16} />
          </span>
          <span className="label">ISSUE BOOK</span>
        </button>
        <button className="bottom-item" onClick={openReturn}>
          <span className="bottom-dot">
            <RotateCcw size={16} />
          </span>
          <span className="label">RETURN BOOK</span>
        </button>
        <button className="bottom-item" onClick={openAddStudent}>
          <span className="bottom-dot">
            <UserPlus size={16} />
          </span>
          <span className="label">ADD STUDENT</span>
        </button>
      </div>

      {sheet === "menu" && (
        <Modal title="More" onClose={() => setSheet(null)}>
          <div className="menu-list">
            <button className="menu-row" onClick={() => setSheet("dashboard")}>
              <LayoutDashboard size={18} /> Dashboard
            </button>
            <button className="menu-row" onClick={() => setSheet("catalog")}>
              <Library size={18} /> Book Catalog
            </button>
            <button className="menu-row" onClick={() => setSheet("bookCategories")}>
              <Bookmark size={18} /> Book Categories
            </button>
            <button className="menu-row" onClick={() => setSheet("classes")}>
              <Layers size={18} /> Manage Classes
            </button>
            <button className="menu-row" onClick={() => setSheet("overdue")}>
              <AlertTriangle size={18} /> Overdue Books
              {overdueTx.length > 0 && <span className="badge">{overdueTx.length}</span>}
            </button>
            <button className="menu-row" onClick={() => setSheet("printCards")}>
              <Printer size={18} /> Print Labels (Barcodes)
            </button>
            <button
              className="menu-row"
              onClick={() => {
                setChangeNewPw("");
                setChangeNewPw2("");
                setChangeError("");
                setChangeSuccess(false);
                setSheet("changePassword");
              }}
            >
              <Lock size={18} /> Change Password
            </button>
            <button className="menu-row" onClick={handleSignOut}>
              <LogOut size={18} /> Sign Out
            </button>
          </div>
        </Modal>
      )}

      {sheet === "changePassword" && (
        <Modal title="Change Password" onClose={() => setSheet(null)}>
          {changeSuccess ? (
            <div className="empty">
              <Check size={18} style={{ marginBottom: "0.3rem" }} />
              <br />
              Password updated.
            </div>
          ) : (
            <form onSubmit={handleChangePassword}>
              {changeError && <div className="lock-error">{changeError}</div>}
              <div className="field">
                <label>New password</label>
                <input
                  type="password"
                  value={changeNewPw}
                  onChange={(e) => setChangeNewPw(e.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label>Confirm new password</label>
                <input
                  type="password"
                  value={changeNewPw2}
                  onChange={(e) => setChangeNewPw2(e.target.value)}
                  required
                />
              </div>
              <button type="submit" className="btn full"><Lock size={15} /> Update Password</button>
            </form>
          )}
        </Modal>
      )}

      {sheet === "printCards" && (
        <Modal title="Print Labels" onClose={() => setSheet(null)}>
          <div className="no-print">
            <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.7rem" }}>
              <button
                className={`btn ${printMode === "students" ? "" : "secondary"}`}
                style={{ flex: 1, justifyContent: "center" }}
                onClick={() => setPrintMode("students")}
              >
                Students
              </button>
              <button
                className={`btn ${printMode === "books" ? "" : "secondary"}`}
                style={{ flex: 1, justifyContent: "center" }}
                onClick={() => setPrintMode("books")}
              >
                Books
              </button>
            </div>
            {printMode === "students" && (
              <select
                value={printClass}
                onChange={(e) => setPrintClass(e.target.value)}
                style={{ marginBottom: "0.7rem" }}
              >
                <option value="ALL">All classes</option>
                {classes.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            )}
            <p style={{ fontSize: "0.78rem", color: "var(--text-soft)", marginBottom: "0.8rem" }}>
              Each barcode encodes the {printMode === "students" ? "roll number" : "book code"} —
              scanning it in the app finds that {printMode === "students" ? "student" : "book"}{" "}
              automatically. Tap Print, then choose "Save as PDF" to print or share.
            </p>
            <button className="btn full" onClick={() => window.print()}>
              <Printer size={16} /> Print / Save as PDF
            </button>
          </div>

          <div className="print-area">
            {printMode === "students"
              ? students
                  .filter((s) => printClass === "ALL" || s.className === printClass)
                  .map((s) => (
                    <div className="id-card" key={s.id}>
                      <div className="id-card-name">{s.name}</div>
                      <div className="id-card-meta">{s.className} · Roll {s.roll}</div>
                      <BarcodeSVG value={s.roll} />
                    </div>
                  ))
              : books.map((b) => (
                  <div className="id-card" key={b.id}>
                    <BarcodeSVG value={b.code} />
                  </div>
                ))}
          </div>
        </Modal>
      )}

      {sheet === "issue" && (
        <Modal title="Issue Book" onClose={() => setSheet(null)}>
          {selectedStudent ? (
            <div className="current-pick">
              <span>
                Student: <b>{selectedStudent.name}</b> ({selectedStudent.className})
              </span>
              <button onClick={() => setSelectedStudentId(null)}>Change</button>
            </div>
          ) : (
            <div className="field">
              <label>Find student</label>
              <div className="scan-row">
                <input
                  type="search"
                  value={issueStudentQuery}
                  onChange={(e) => setIssueStudentQuery(e.target.value)}
                  placeholder="Name or roll number..."
                />
                <button type="button" className="scan-btn-inline" onClick={() => openScanner("issueStudent")} aria-label="Scan student ID">
                  <Camera size={16} />
                </button>
              </div>
              <div className="pick-list">
                {issueStudentMatches.length === 0 && <div className="empty">No students found</div>}
                {issueStudentMatches.map((s) => (
                  <button key={s.id} className="pick-item" onClick={() => setSelectedStudentId(s.id)}>
                    <span className="badge">{s.roll}</span>
                    <span>
                      <div className="t-title">{s.name}</div>
                      <div className="t-meta">{s.className}</div>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="field">
            <label>Find book</label>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <input
                type="search"
                style={{ flex: 1 }}
                value={bookQuery}
                onChange={(e) => setBookQuery(e.target.value)}
                placeholder="Title, author or code..."
              />
              <button type="button" className="scan-btn-inline" onClick={() => openScanner("issueBook")} aria-label="Scan book barcode">
                <Camera size={16} />
              </button>
            </div>
            <div className="pick-list">
              {issueBookMatches.length === 0 && <div className="empty">No books found</div>}
              {issueBookMatches.map((b) => (
                <button
                  key={b.id}
                  className={`pick-item ${selectedBook?.id === b.id ? "selected" : ""}`}
                  onClick={() => setSelectedBook(b)}
                  disabled={b.availableCopies < 1}
                >
                  <span className="badge">{b.availableCopies}/{b.totalCopies}</span>
                  <span>
                    <div className="t-title">{b.title}</div>
                    <div className="t-meta">{b.author} · {b.code}</div>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="form-grid" style={{ gridTemplateColumns: "120px 1fr", alignItems: "end" }}>
            <div>
              <label>Days</label>
              <input type="number" min="1" value={days} onChange={(e) => setDays(e.target.value)} />
            </div>
            <div>
              <button
                className="btn full"
                disabled={!selectedStudentId || !selectedBook || selectedBook.availableCopies < 1}
                onClick={issueBook}
              >
                <BookMarked size={16} /> Issue Book
              </button>
            </div>
          </div>

          {lastIssued && (
            <div className="stamp-card">
              <div className="stamp-mark">
                <div className="l1">Issued</div>
                <div className="l2">{formatDate(lastIssued.dueDate)}</div>
              </div>
              <div className="stamp-info">
                <b>{lastIssued.bookTitle}</b> issued to {lastIssued.studentName}.
                <br />
                Due on <b>{formatDate(lastIssued.dueDate)}</b>
              </div>
            </div>
          )}
        </Modal>
      )}

      {sheet === "return" && (
        <Modal title="Return Book" onClose={() => setSheet(null)}>
          {selectedStudent ? (
            <>
              <div className="current-pick">
                <span>
                  Student: <b>{selectedStudent.name}</b> ({selectedStudent.className})
                </span>
                <button onClick={() => setSelectedStudentId(null)}>Change</button>
              </div>
              {studentActiveTx(selectedStudent.id).length === 0 ? (
                <div className="empty">This student has no books currently issued.</div>
              ) : (
                <div className="row-list">
                  {studentActiveTx(selectedStudent.id).map((t) => {
                    const book = bookById(t.bookId);
                    const overdue = t.dueDate < todayISO();
                    return (
                      <div key={t.id} className={`row-card ${overdue ? "overdue" : ""}`}>
                        <div>
                          <div className="title">{book?.title}</div>
                          <div className="meta">{book?.code}</div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                          <div className="due">{overdue ? "Overdue: " : "Due: "}{formatDate(t.dueDate)}</div>
                          {justReturnedId === t.id ? (
                            <span className="returned-flash"><Check size={14} /> Returned</span>
                          ) : (
                            <button className="btn secondary" onClick={() => returnBook(t.id)}>
                              <RotateCcw size={13} /> Return
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="field" style={{ display: "flex", gap: "0.5rem" }}>
                <input
                  type="search"
                  style={{ flex: 1 }}
                  value={returnQuery}
                  onChange={(e) => setReturnQuery(e.target.value)}
                  placeholder="Search book or student name..."
                />
                <button type="button" className="scan-btn-inline" onClick={() => openScanner("return")} aria-label="Scan barcode">
                  <Camera size={16} />
                </button>
              </div>
              {returnSearchMatches.length === 0 ? (
                <div className="empty">No books currently issued.</div>
              ) : (
                <div className="row-list">
                  {returnSearchMatches.map((r) => {
                    const overdue = r.tx.dueDate < todayISO();
                    return (
                      <div key={r.tx.id} className={`row-card ${overdue ? "overdue" : ""}`}>
                        <div>
                          <div className="title">{r.book.title}</div>
                          <div className="meta">{r.student.name} ({r.student.className})</div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                          <div className="due">{overdue ? "Overdue: " : "Due: "}{formatDate(r.tx.dueDate)}</div>
                          {justReturnedId === r.tx.id ? (
                            <span className="returned-flash"><Check size={14} /> Returned</span>
                          ) : (
                            <button className="btn secondary" onClick={() => returnBook(r.tx.id)}>
                              <RotateCcw size={13} /> Return
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </Modal>
      )}

      {sheet === "addStudent" && (
        <Modal title="Students" onClose={() => setSheet(null)}>
          <form onSubmit={addStudent}>
            <div className="field">
              <label>Name</label>
              <input
                type="text"
                value={studentForm.name}
                onChange={(e) => setStudentForm({ ...studentForm, name: e.target.value })}
                required
              />
            </div>
            <div className="form-grid">
              <div>
                <label>Class</label>
                <select
                  value={studentForm.className}
                  onChange={(e) => setStudentForm({ ...studentForm, className: e.target.value })}
                >
                  {classes.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label>Roll number</label>
                <input
                  type="text"
                  value={studentForm.roll}
                  onChange={(e) => setStudentForm({ ...studentForm, roll: e.target.value })}
                  required
                />
              </div>
            </div>
            <button type="submit" className="btn full"><Plus size={16} /> Add Student</button>
          </form>

          <div style={{ borderTop: "1px solid #EEE", marginTop: "1.1rem", paddingTop: "0.9rem" }}>
            <h2 style={{ fontFamily: "Playfair Display, serif", fontSize: "0.98rem", color: "var(--navy)", marginBottom: "0.5rem" }}>
              Add many at once
            </h2>
            <p style={{ fontSize: "0.78rem", color: "var(--text-soft)", marginBottom: "0.6rem" }}>
              Paste one student per line. Either just a name (uses the class/roll below), or
              "Name, Class, Roll" per line — handy for pasting straight from a spreadsheet, and
              mixing several classes in one paste.
            </p>
            <form onSubmit={addStudentsBulk}>
              <div className="form-grid">
                <div>
                  <label>Default class</label>
                  <select value={bulkClass} onChange={(e) => setBulkClass(e.target.value)}>
                    {classes.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label>Starting roll no. (optional)</label>
                  <input
                    type="text"
                    value={bulkStartRoll}
                    onChange={(e) => setBulkStartRoll(e.target.value)}
                    placeholder="e.g. 1"
                  />
                </div>
              </div>
              <div className="field">
                <label>Students — one per line</label>
                <textarea
                  rows={5}
                  value={bulkNames}
                  onChange={(e) => setBulkNames(e.target.value)}
                  placeholder={"Fathima, CLASS-1, 12\nAhmed Riyas, CLASS-2, 7\nAisha\nMuhammed Shiyas, CLASS-3"}
                  style={{
                    width: "100%",
                    fontFamily: "Inter, sans-serif",
                    fontSize: "0.92rem",
                    padding: "0.55rem 0.7rem",
                    border: "1px solid #DDD",
                    borderRadius: "6px",
                    background: "#FAFAFA",
                    color: "var(--text)",
                    resize: "vertical",
                  }}
                />
              </div>
              <button type="submit" className="btn full secondary">
                <Plus size={16} /> Add All Students
              </button>
            </form>
          </div>

          <div style={{ borderTop: "1px solid #EEE", marginTop: "1.1rem", paddingTop: "0.9rem" }}>
            <h2 style={{ fontFamily: "Playfair Display, serif", fontSize: "0.98rem", color: "var(--navy)", marginBottom: "0.5rem" }}>
              All students
            </h2>
            <input
              type="search"
              value={studentListQuery}
              onChange={(e) => setStudentListQuery(e.target.value)}
              placeholder="Search name or roll..."
              style={{ marginBottom: "0.6rem" }}
            />
            <div className="row-list" style={{ maxHeight: 280, overflowY: "auto" }}>
              {studentListForManage.length === 0 && <div className="empty">No students yet.</div>}
              {studentListForManage.map((s) =>
                editingStudentId === s.id ? (
                  <form key={s.id} onSubmit={saveEditStudent} className="row-card" style={{ flexDirection: "column", alignItems: "stretch", gap: "0.5rem" }}>
                    <input
                      type="text"
                      value={editForm.name}
                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      required
                    />
                    <div className="form-grid" style={{ marginBottom: 0 }}>
                      <select
                        value={editForm.className}
                        onChange={(e) => setEditForm({ ...editForm, className: e.target.value })}
                      >
                        {classes.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={editForm.roll}
                        onChange={(e) => setEditForm({ ...editForm, roll: e.target.value })}
                        required
                      />
                    </div>
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <button type="submit" className="btn" style={{ flex: 1, justifyContent: "center" }}>
                        <Check size={14} /> Save
                      </button>
                      <button type="button" className="btn secondary" style={{ flex: 1, justifyContent: "center" }} onClick={cancelEditStudent}>
                        <X size={14} /> Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <div key={s.id} className="row-card">
                    <div>
                      <div className="title">{s.name}</div>
                      <div className="meta">{s.className} · Roll {s.roll}</div>
                    </div>
                    <button className="btn secondary" onClick={() => startEditStudent(s)}>
                      <Pencil size={13} /> Edit
                    </button>
                  </div>
                )
              )}
            </div>
          </div>
        </Modal>
      )}

      {sheet === "bookCategories" && (
        <Modal title="Book Categories" onClose={() => setSheet(null)}>
          <form onSubmit={addCategory} style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end", marginBottom: "1rem" }}>
            <div style={{ flex: 1 }}>
              <label>New category name</label>
              <input
                type="text"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="e.g. Fiqh"
              />
            </div>
            <button type="submit" className="btn">
              <Plus size={16} /> Add
            </button>
          </form>
          <div className="row-list">
            {categories.map((c) => {
              const count = books.filter((b) => b.category === c).length;
              return editingCategoryOld === c ? (
                <form
                  key={c}
                  onSubmit={saveEditCategory}
                  className="row-card"
                  style={{ flexDirection: "column", alignItems: "stretch", gap: "0.5rem" }}
                >
                  <input
                    type="text"
                    value={editCategoryName}
                    onChange={(e) => setEditCategoryName(e.target.value)}
                    required
                  />
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button type="submit" className="btn" style={{ flex: 1, justifyContent: "center" }}>
                      <Check size={14} /> Save
                    </button>
                    <button
                      type="button"
                      className="btn secondary"
                      style={{ flex: 1, justifyContent: "center" }}
                      onClick={cancelEditCategory}
                    >
                      <X size={14} /> Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <div key={c} className="row-card">
                  <div>
                    <div className="title">{c}</div>
                    <div className="meta">{count} book{count === 1 ? "" : "s"}</div>
                  </div>
                  <div style={{ display: "flex", gap: "0.4rem" }}>
                    <button className="btn secondary" onClick={() => startEditCategory(c)} aria-label="Rename category">
                      <Pencil size={13} />
                    </button>
                    <button className="btn secondary" onClick={() => deleteCategory(c)} aria-label="Remove category">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </Modal>
      )}

      {sheet === "catalog" && (
        <Modal title="Book Catalog" onClose={() => setSheet(null)}>
          <div className="field">
            <input
              type="search"
              value={catalogQuery}
              onChange={(e) => setCatalogQuery(e.target.value)}
              placeholder="Search books..."
            />
          </div>
          <div style={{ maxHeight: 340, overflowY: "auto", marginBottom: "1rem" }}>
            {catalogGrouped.length === 0 ? (
              <div className="empty">No books found.</div>
            ) : (
              catalogGrouped.map(([cat, list]) => (
                <div key={cat} style={{ marginBottom: "0.9rem" }}>
                  <h3
                    style={{
                      fontFamily: "Playfair Display, serif",
                      fontSize: "0.88rem",
                      color: "var(--navy)",
                      margin: "0 0 0.4rem",
                      borderBottom: "1px solid #EEE",
                      paddingBottom: "0.25rem",
                    }}
                  >
                    {cat}{" "}
                    <span style={{ color: "var(--text-soft)", fontWeight: 400, fontSize: "0.75rem" }}>
                      ({list.length})
                    </span>
                  </h3>
                  <div className="row-list">
                    {list.map((b) =>
                      editingBookId === b.id ? (
                        <form
                          key={b.id}
                          onSubmit={saveEditBook}
                          className="row-card"
                          style={{ flexDirection: "column", alignItems: "stretch", gap: "0.5rem" }}
                        >
                          <input
                            type="text"
                            value={editBookForm.title}
                            onChange={(e) => setEditBookForm({ ...editBookForm, title: e.target.value })}
                            placeholder="Title"
                            required
                          />
                          <input
                            type="text"
                            value={editBookForm.author}
                            onChange={(e) => setEditBookForm({ ...editBookForm, author: e.target.value })}
                            placeholder="Author"
                          />
                          <div className="form-grid" style={{ marginBottom: 0 }}>
                            <select
                              value={editBookForm.category}
                              onChange={(e) => setEditBookForm({ ...editBookForm, category: e.target.value })}
                            >
                              <option value="">Uncategorized</option>
                              {categories.map((c) => (
                                <option key={c} value={c}>{c}</option>
                              ))}
                            </select>
                            <input
                              type="number"
                              min="1"
                              value={editBookForm.copies}
                              onChange={(e) => setEditBookForm({ ...editBookForm, copies: e.target.value })}
                            />
                          </div>
                          <div className="meta" style={{ fontSize: "0.72rem" }}>Code: {b.code} (fixed)</div>
                          <div style={{ display: "flex", gap: "0.5rem" }}>
                            <button type="submit" className="btn" style={{ flex: 1, justifyContent: "center" }}>
                              <Check size={14} /> Save
                            </button>
                            <button
                              type="button"
                              className="btn secondary"
                              style={{ flex: 1, justifyContent: "center" }}
                              onClick={cancelEditBook}
                            >
                              <X size={14} /> Cancel
                            </button>
                          </div>
                        </form>
                      ) : (
                        <div key={b.id} className="row-card">
                          <div>
                            <div className="title">{b.title}</div>
                            <div className="meta">
                              {b.author} · {b.code} · {b.availableCopies}/{b.totalCopies}
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: "0.4rem" }}>
                            <button className="btn secondary" onClick={() => startEditBook(b)} aria-label="Edit book">
                              <Pencil size={13} />
                            </button>
                            <button className="btn secondary" onClick={() => deleteBook(b)} aria-label="Remove book">
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      )
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
          <h2 style={{ fontFamily: "Playfair Display, serif", fontSize: "1rem", color: "var(--navy)" }}>Add New Book</h2>
          <form onSubmit={addBook}>
            <div className="field">
              <label>Title</label>
              <input
                type="text"
                value={bookForm.title}
                onChange={(e) => setBookForm({ ...bookForm, title: e.target.value })}
                required
              />
            </div>
            <div className="field">
              <label>Author</label>
              <input
                type="text"
                value={bookForm.author}
                onChange={(e) => setBookForm({ ...bookForm, author: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Category</label>
              <select
                value={bookForm.category}
                onChange={(e) => setBookForm({ ...bookForm, category: e.target.value })}
              >
                <option value="">Uncategorized</option>
                {categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="form-grid">
              <div>
                <label>Code</label>
                <input
                  type="text"
                  value={bookForm.code}
                  onChange={(e) => setBookForm({ ...bookForm, code: e.target.value })}
                  required
                />
              </div>
              <div>
                <label>Copies</label>
                <input
                  type="number"
                  min="1"
                  value={bookForm.copies}
                  onChange={(e) => setBookForm({ ...bookForm, copies: e.target.value })}
                />
              </div>
            </div>
            <button type="submit" className="btn full"><Plus size={16} /> Add Book</button>
          </form>

          <div style={{ borderTop: "1px solid #EEE", marginTop: "1.1rem", paddingTop: "0.9rem" }}>
            <h2 style={{ fontFamily: "Playfair Display, serif", fontSize: "0.98rem", color: "var(--navy)", marginBottom: "0.5rem" }}>
              Add many at once
            </h2>
            <p style={{ fontSize: "0.78rem", color: "var(--text-soft)", marginBottom: "0.6rem" }}>
              Pick a category below and every book in this paste gets that category — so for a
              whole stack from one category, just paste "Code, Title, Author, Copies" lines (no
              need to repeat the category each line). To mix categories in one paste, add a 5th
              column per line ("Code, Title, Author, Copies, Category") — that overrides the
              default for just that line. A book with the same code already in the catalog gets
              overwritten with these details.
            </p>
            <form onSubmit={addBooksBulk}>
              <div className="field">
                <label>Category for this batch</label>
                <select value={bulkBookCategory} onChange={(e) => setBulkBookCategory(e.target.value)}>
                  <option value="">Uncategorized</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Books — one per line</label>
                <textarea
                  rows={6}
                  value={bulkBooksText}
                  onChange={(e) => setBulkBooksText(e.target.value)}
                  placeholder={"SH21, ദേശഭക്തി, എ ബി സി, 2\nHW50, ഒരു കഥ, എക്സ് വൈ ഇസഡ്\nSM11, പുതിയ പുസ്തകം"}
                  style={{
                    width: "100%",
                    fontFamily: "Inter, sans-serif",
                    fontSize: "0.92rem",
                    padding: "0.55rem 0.7rem",
                    border: "1px solid #DDD",
                    borderRadius: "6px",
                    background: "#FAFAFA",
                    color: "var(--text)",
                    resize: "vertical",
                  }}
                />
              </div>
              <button type="submit" className="btn full secondary">
                <Plus size={16} /> Add All Books
              </button>
            </form>
          </div>
        </Modal>
      )}

      {sheet === "classes" && (
        <Modal title="Manage Classes" onClose={() => setSheet(null)}>
          <form onSubmit={addClass} style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end", marginBottom: "1rem" }}>
            <div style={{ flex: 1 }}>
              <label>New class name</label>
              <input
                type="text"
                value={newClassName}
                onChange={(e) => setNewClassName(e.target.value)}
                placeholder="e.g. CLASS-7"
              />
            </div>
            <button type="submit" className="btn">
              <Plus size={16} /> Add
            </button>
          </form>
          <div className="row-list">
            {classes.map((c) => {
              const count = students.filter((s) => s.className === c).length;
              return editingClassOld === c ? (
                <form
                  key={c}
                  onSubmit={saveEditClass}
                  className="row-card"
                  style={{ flexDirection: "column", alignItems: "stretch", gap: "0.5rem" }}
                >
                  <input
                    type="text"
                    value={editClassName}
                    onChange={(e) => setEditClassName(e.target.value)}
                    required
                  />
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button type="submit" className="btn" style={{ flex: 1, justifyContent: "center" }}>
                      <Check size={14} /> Save
                    </button>
                    <button
                      type="button"
                      className="btn secondary"
                      style={{ flex: 1, justifyContent: "center" }}
                      onClick={cancelEditClass}
                    >
                      <X size={14} /> Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <div key={c} className="row-card">
                  <div>
                    <div className="title">{c}</div>
                    <div className="meta">{count} student{count === 1 ? "" : "s"}</div>
                  </div>
                  <div style={{ display: "flex", gap: "0.4rem" }}>
                    <button className="btn secondary" onClick={() => startEditClass(c)} aria-label="Rename class">
                      <Pencil size={13} />
                    </button>
                    <button className="btn secondary" onClick={() => deleteClass(c)} aria-label="Remove class">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </Modal>
      )}

      {sheet === "dashboard" && (
        <Modal title="Dashboard" onClose={() => setSheet(null)}>
          <div className="grid-stats">
            <div className="stat-card">
              <div className="num">{totalCopies}</div>
              <div className="label">Total Books</div>
            </div>
            <div className="stat-card">
              <div className="num">{availableCopies}</div>
              <div className="label">Available</div>
            </div>
            <div className="stat-card">
              <div className="num">{activeTx.length}</div>
              <div className="label">Currently Issued</div>
            </div>
            <div className={`stat-card ${overdueTx.length > 0 ? "warn" : ""}`}>
              <div className="num">{overdueTx.length}</div>
              <div className="label">Overdue</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="label" style={{ marginBottom: "0.4rem" }}>Students</div>
            <div className="num" style={{ fontSize: "1.1rem" }}>{students.length}</div>
          </div>
        </Modal>
      )}

      {sheet === "overdue" && (
        <Modal title="Overdue Books" onClose={() => setSheet(null)}>
          {overdueList.length === 0 ? (
            <div className="empty">Nothing overdue right now.</div>
          ) : (
            <div className="row-list">
              {overdueList.map((r) => (
                <div key={r.tx.id} className="row-card overdue">
                  <div>
                    <div className="title">{r.book.title}</div>
                    <div className="meta">{r.student.name} ({r.student.className}) · Roll {r.student.roll}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                    <div className="due">
                      <Clock size={12} style={{ verticalAlign: "-2px" }} /> {daysBetween(r.tx.dueDate, todayISO())}d late
                    </div>
                    <button className="btn secondary" onClick={() => returnBook(r.tx.id)}>
                      <RotateCcw size={13} /> Return
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}

      {sheet === "studentDetail" && detailStudentId && (() => {
        const dStudent = studentById(detailStudentId);
        if (!dStudent) return null;
        const dTx = transactions
          .filter((t) => t.studentId === detailStudentId)
          .sort((a, b) => (a.issueDate < b.issueDate ? 1 : -1));
        return (
          <Modal title={dStudent.name} onClose={() => setSheet(null)}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: "0.9rem" }}>
              <Avatar name={dStudent.name} photoUrl={dStudent.photoUrl} size={84} />
            </div>

            <div className="current-pick" style={{ marginBottom: "0.9rem" }}>
              <span>{dStudent.className} · Roll {dStudent.roll}</span>
              <button onClick={() => startEditStudent(dStudent)}>
                <Pencil size={12} style={{ verticalAlign: "-1px" }} /> Edit
              </button>
            </div>

            <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
              <button
                className="btn"
                style={{ flex: 1, justifyContent: "center" }}
                onClick={() => {
                  setSelectedStudentId(dStudent.id);
                  openIssue();
                }}
              >
                <BookMarked size={15} /> Issue
              </button>
              <button
                className="btn secondary"
                style={{ flex: 1, justifyContent: "center" }}
                onClick={() => {
                  setSelectedStudentId(dStudent.id);
                  openReturn();
                }}
              >
                <RotateCcw size={15} /> Return
              </button>
            </div>

            {editingStudentId === dStudent.id && (
              <form onSubmit={saveEditStudent} className="row-card" style={{ flexDirection: "column", alignItems: "stretch", gap: "0.5rem", marginBottom: "1rem" }}>
                <input
                  type="text"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  required
                />
                <div className="form-grid" style={{ marginBottom: 0 }}>
                  <select
                    value={editForm.className}
                    onChange={(e) => setEditForm({ ...editForm, className: e.target.value })}
                  >
                    {classes.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={editForm.roll}
                    onChange={(e) => setEditForm({ ...editForm, roll: e.target.value })}
                    required
                  />
                </div>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button type="submit" className="btn" style={{ flex: 1, justifyContent: "center" }}>
                    <Check size={14} /> Save
                  </button>
                  <button type="button" className="btn secondary" style={{ flex: 1, justifyContent: "center" }} onClick={cancelEditStudent}>
                    <X size={14} /> Cancel
                  </button>
                </div>
              </form>
            )}

            <h2 style={{ fontFamily: "Playfair Display, serif", fontSize: "0.98rem", color: "var(--navy)", marginBottom: "0.5rem" }}>
              Book history
            </h2>
            {dTx.length === 0 ? (
              <div className="empty">No books issued to this student yet.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Book</th>
                      <th>Code</th>
                      <th>Issued</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dTx.map((t, i) => {
                      const book = bookById(t.bookId);
                      const overdue = !t.returnDate && t.dueDate < todayISO();
                      return (
                        <tr key={t.id}>
                          <td className="mono">{i + 1}</td>
                          <td>{book ? book.title : "—"}</td>
                          <td className="mono">{book ? book.code : "—"}</td>
                          <td className="mono">{formatDate(t.issueDate)}</td>
                          <td>
                            {t.returnDate ? (
                              <span style={{ color: "#1F8A5E", fontWeight: 700 }}>
                                Returned {formatDate(t.returnDate)}
                              </span>
                            ) : overdue ? (
                              <span style={{ color: "var(--danger)", fontWeight: 700 }}>
                                Overdue · due {formatDate(t.dueDate)}
                              </span>
                            ) : (
                              <span style={{ color: "var(--indigo)", fontWeight: 700 }}>
                                Not returned · due {formatDate(t.dueDate)}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Modal>
        );
      })()}

      {scannerTarget && (
        <Scanner onResult={handleScanResult} onClose={() => setScannerTarget(null)} feedback={scanFeedback} />
      )}
        </>
      )}
    </div>
  );
}
