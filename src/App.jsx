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
            <div className="scanner-f
