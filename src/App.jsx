import { useState, useEffect, useMemo, useRef } from "react";
import {
  LayoutDashboard, Library, AlertTriangle, Search, Plus, Check, Clock,
  BookMarked, RotateCcw, UserPlus, MoreVertical, X, Layers, Pencil,
  ChevronRight, Lock, Camera, LogOut, Printer, Trash2, Bookmark,
  MessageCircle, CreditCard, Download, Award, GraduationCap, QrCode,
  Settings, Save, Palette, FileDown,
} from "lucide-react";
import { BrowserMultiFormatReader } from "@zxing/library";
import QRCode from "qrcode";
import html2canvas from "html2canvas";
import { auth, db } from "./firebaseClient";
import {
  onAuthStateChanged, signInWithEmailAndPassword, signOut, updatePassword,
} from "firebase/auth";
import {
  collection, doc, onSnapshot, setDoc, updateDoc, addDoc,
  query, where, getDocs, deleteDoc, writeBatch,
} from "firebase/firestore";

const DEFAULT_CLASSES = ["CLASS-1", "CLASS-2", "CLASS-3", "CLASS-4", "CLASS-5", "CLASS-6"];
const DEFAULT_CATEGORIES = [
  "Shihab Thangal Family", "Women in Islamic History", "Mathematics",
  "Spirituality & Philosophy", "Human Rights & Society", "General Literature",
];
const UNCATEGORIZED = "Uncategorized";
const BOOK_QR_PREFIX = "BOOK:";
const SETTINGS_DEFAULTS = {
  libraryName: "NMMI ISLAMIC LIBRARY",
  librarySubtitle: "Nandiyil Muhammed Musliyar Memorial Islamic Library",
  librarianName: "",
  phone: "",
  email: "",
  defaultLoanDays: 14,
  maxBooksPerStudent: 3,
  finePerDay: 0,
  graceDays: 0,
  reminderDaysBefore: 2,
  darkMode: false,
};

function bookQrValue(code) { return BOOK_QR_PREFIX + stripSpaces(code); }
function parseBookQrValue(text) {
  const raw = (text || "").trim();
  if (raw.toUpperCase().startsWith(BOOK_QR_PREFIX)) return stripSpaces(raw.slice(BOOK_QR_PREFIX.length));
  return stripSpaces(raw);
}
function inferCategoryFromCode(code) {
  if (/^SH\d/i.test(code)) return "Shihab Thangal Family";
  if (/^HW\d/i.test(code)) return "Women in Islamic History";
  if (/^SM\d/i.test(code)) return "Mathematics";
  if (/^SPY\d/i.test(code)) return "Spirituality & Philosophy";
  if (/^SHR\d/i.test(code)) return "Human Rights & Society";
  if (/^B\d/i.test(code)) return "General Literature";
  return "";
}
function normCode(s) { return (s || "").replace(/\s+/g, "").toLowerCase(); }
function stripSpaces(s) { return (s || "").replace(/\s+/g, ""); }
function resizeImageToDataURL(file, maxSize = 160, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height) { if (width > maxSize) { height = Math.round(height * (maxSize / width)); width = maxSize; } }
        else if (height > maxSize) { width = Math.round(width * (maxSize / height)); height = maxSize; }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => reject(new Error("Couldn't read that image"));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error("Couldn't read that file"));
    reader.readAsDataURL(file);
  });
}
function waLink(phone, message) {
  let digits = (phone || "").replace(/\D/g, "");
  if (digits.length === 10) digits = "91" + digits;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function todayISO() { return new Date().toISOString().slice(0, 10); }
function addDays(dateStr, days) {
  const d = new Date(dateStr + "T00:00:00"); d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
function formatMonthLabel(ym) {
  if (!ym) return "";
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, (m || 1) - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}
function daysBetween(a, b) {
  return Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / (1000 * 60 * 60 * 24));
}

let _audioCtx = null;
function getAudioCtx() {
  try {
    if (!_audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      _audioCtx = new AC();
    }
    if (_audioCtx.state === "suspended") _audioCtx.resume().catch(() => {});
    return _audioCtx;
  } catch { return null; }
}
function playTone(freq, dur, type, vol, delay) {
  const ctx = getAudioCtx(); if (!ctx) return;
  try {
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = type || "sine"; osc.frequency.value = freq;
    osc.connect(gain); gain.connect(ctx.destination);
    const start = ctx.currentTime + (delay || 0) / 1000;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(vol || 0.2, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur / 1000);
    osc.start(start); osc.stop(start + dur / 1000 + 0.03);
  } catch {}
}
function playScanSound(kind) {
  if (kind === "success") { playTone(1047, 90, "sine", 0.22, 0); playTone(1568, 140, "sine", 0.2, 70); }
  else if (kind === "returnSuccess") { playTone(784, 100, "sine", 0.2, 0); playTone(523, 150, "sine", 0.18, 90); }
  else if (kind === "error") playTone(220, 170, "square", 0.16, 0);
  else if (kind === "warning") { playTone(440, 90, "triangle", 0.2, 0); playTone(440, 90, "triangle", 0.2, 140); }
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

const NMMI_SEED_BOOKS = [
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

function Modal({ title, onClose, children, wide }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`modal-panel ${wide ? "modal-wide" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

function QRCodeCanvas({ value, size = 130 }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current && value) {
      QRCode.toCanvas(ref.current, String(value), { width: size, margin: 1 }, (err) => {
        if (err) console.error(err);
      });
    }
  }, [value, size]);
  if (!value) return null;
  return <canvas ref={ref} className="id-qrcode" />;
}

function Avatar({ name, photoUrl, size = 42, children }) {
  const initial = (name || "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <div className="avatar" style={{ width: size, height: size }}>
      {photoUrl ? <img src={photoUrl} alt="" className="avatar-img" /> : (
        <span className="avatar-letter" style={{ fontSize: Math.round(size * 0.42) }}>{initial}</span>
      )}
      {children}
    </div>
  );
}

function Scanner({ onResult, onClose, feedback }) {
  const videoRef = useRef(null);
  const readerRef = useRef(null);
  const [status, setStatus] = useState("starting");
  const [errMsg, setErrMsg] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const reader = new BrowserMultiFormatReader();
        readerRef.current = reader;
        await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: "environment" } } },
          videoRef.current,
          (result) => { if (active && result) onResult(result.getText()); }
        );
        if (active) setStatus("scanning");
      } catch (e) {
        if (active) {
          setStatus("error");
          setErrMsg(e?.name === "NotAllowedError" ? "Camera permission denied." : (e?.message || "Could not access the camera."));
        }
      }
    })();
    return () => { active = false; try { readerRef.current?.reset(); } catch {} };
  }, []);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Scan QR Code</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
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
          <div className="lock-hint">Point the camera at the QR code on the card.</div>
        </div>
      </div>
    </div>
  );
}

function DesktopScannerWaiting({ onClose, onUseCamera, feedback }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Scan QR Code</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="modal-body" style={{ textAlign: "center", padding: "0.5rem 0.4rem 1.2rem" }}>
          {feedback ? (
            <div className={`scan-feedback-inline scan-feedback-${feedback.type}`}>
              {feedback.type === "success" && <Check size={56} />}
              {feedback.type === "error" && <X size={56} />}
              {feedback.type === "warning" && <AlertTriangle size={56} />}
              {feedback.message && <div className="scan-feedback-msg">{feedback.message}</div>}
            </div>
          ) : (
            <>
              <div className="pulse-icon"><QrCode size={56} /></div>
              <h3 style={{ marginTop: "1.2rem", marginBottom: "0.4rem", fontFamily: "'Playfair Display', serif", color: "var(--navy)", fontSize: "1.05rem" }}>
                Waiting for scan…
              </h3>
              <p style={{ color: "var(--text-soft)", fontSize: "0.86rem", margin: "0 0.5rem", lineHeight: 1.5 }}>
                Point your connected QR scanner at the code — it will be captured automatically.
              </p>
              <p style={{ color: "var(--text-soft)", fontSize: "0.76rem", marginTop: "1.2rem" }}>
                No scanner?{" "}
                <button type="button" style={{ background: "none", border: "none", color: "var(--indigo)", textDecoration: "underline", cursor: "pointer", padding: 0, fontSize: "inherit", fontWeight: 600 }} onClick={onUseCamera}>
                  Use camera instead
                </button>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function PublicCatalog() {
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "books"),
      (qsnap) => { setBooks(qsnap.docs.map((d) => ({ id: d.id, ...d.data() }))); setLoading(false); },
      () => setLoading(false)
    );
    return unsub;
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return books;
    return books.filter((b) =>
      (b.title || "").toLowerCase().includes(q) ||
      (b.author || "").toLowerCase().includes(q) ||
      normCode(b.code).includes(normCode(q))
    );
  }, [query, books]);

  const grouped = useMemo(() => {
    const groups = {};
    filtered.forEach((b) => {
      const cat = b.category && b.category.trim() ? b.category : "General";
      (groups[cat] = groups[cat] || []).push(b);
    });
    return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  return (
    <div className="pc-app">
      <style>{`
        .pc-app { --navy:#1B4D3E;--maroon:#8B2E3C;--sky:#C9A227;--text:#2B2420;--text-soft:#7A6F5D;--line:#E8DCC0;--row-bg:#FBF2D9;font-family:'Inter',-apple-system,sans-serif;max-width:520px;margin:0 auto;min-height:100vh;background:#FDF8ED;padding-bottom:3rem; }
        .pc-header { padding:1.2rem 1.1rem .8rem;text-align:center;border-bottom:3px solid var(--sky); }
        .pc-header h1 { font-family:'Playfair Display',serif;font-weight:800;font-size:1.35rem;color:var(--navy);margin:0; }
        .pc-sub { font-size:.78rem;color:var(--maroon);margin-top:.2rem; }
        .pc-search { padding:.9rem 1.1rem .4rem; }
        .pc-search input { width:100%;font-size:.95rem;padding:.65rem .9rem;border:1px solid var(--line);border-radius:999px;background:#fff;color:var(--text); }
        .pc-group { padding:.8rem 1.1rem 0; }
        .pc-group h2 { font-family:'Playfair Display',serif;font-size:.92rem;color:var(--navy);margin:0 0 .5rem;border-bottom:1px solid var(--line);padding-bottom:.3rem; }
        .pc-row { display:flex;justify-content:space-between;align-items:center;gap:.7rem;background:var(--row-bg);border-radius:10px;padding:.6rem .8rem;margin-bottom:.45rem;box-shadow:0 1px 3px rgba(43,36,32,.07); }
        .pc-title { font-weight:700;font-size:.9rem;color:var(--text); }
        .pc-meta { font-size:.75rem;color:var(--text-soft);margin-top:.1rem; }
        .pc-badge { font-size:.72rem;font-weight:700;padding:.25rem .55rem;border-radius:999px;flex:0 0 auto;white-space:nowrap; }
        .pc-avail { background:#E1F0E6;color:#1F7A52; }
        .pc-out { background:#F3E1E0;color:#8B2E3C; }
        .pc-empty { text-align:center;padding:2.5rem 1rem;color:var(--text-soft);font-size:.9rem; }
        .pc-footer { text-align:center;padding:1.5rem 1rem .5rem; }
        .pc-footer a { color:var(--navy);font-size:.82rem;text-decoration:underline; }
        @media (min-width:1024px){ .pc-app{max-width:900px;} .pc-group{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:.5rem;} .pc-group h2{grid-column:1/-1;} }
      `}</style>
      <div className="pc-header">
        <h1>NMMI ISLAMIC LIBRARY</h1>
        <div className="pc-sub">Book Catalog — Search (no login needed)</div>
      </div>
      <div className="pc-search">
        <input type="search" placeholder="Search by title, author or code..." value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {loading ? <div className="pc-empty">Loading...</div> : grouped.length === 0 ? <div className="pc-empty">No books found.</div> : grouped.map(([cat, list]) => (
        <div key={cat} className="pc-group">
          <h2>{cat}</h2>
          {list.map((b) => (
            <div key={b.id} className="pc-row">
              <div>
                <div className="pc-title">{b.title}</div>
                <div className="pc-meta">{b.author ? `${b.author} · ` : ""}{b.code}</div>
              </div>
              <div className={`pc-badge ${b.availableCopies > 0 ? "pc-avail" : "pc-out"}`}>
                {b.availableCopies > 0 ? `${b.availableCopies} available` : "All issued"}
              </div>
            </div>
          ))}
        </div>
      ))}
      <div className="pc-footer"><a href="/">Library staff sign in →</a></div>
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
  const [sheet, setSheet] = useState(null);
  const [detailStudentId, setDetailStudentId] = useState(null);
  const [detailBookId, setDetailBookId] = useState(null);
  const cardRef = useRef(null);
  const [cardDownloading, setCardDownloading] = useState(false);
  const certRef = useRef(null);
  const [certDownloading, setCertDownloading] = useState(false);
  const [certMonth, setCertMonth] = useState(todayISO().slice(0, 7));
  const [certStudentId, setCertStudentId] = useState("");
  const [promoMap, setPromoMap] = useState({});
  const [promoBusy, setPromoBusy] = useState(false);
  const [promoMsg, setPromoMsg] = useState("");
  const [lastPromotion, setLastPromotion] = useState(null);
  const [printMode, setPrintMode] = useState("students");
  const [printClass, setPrintClass] = useState("ALL");

  const [bookQuery, setBookQuery] = useState("");
  const [selectedBook, setSelectedBook] = useState(null);
  const [issueStudentQuery, setIssueStudentQuery] = useState("");
  const [days, setDays] = useState(14);
  const [lastIssued, setLastIssued] = useState(null);

  const [returnQuery, setReturnQuery] = useState("");
  const [justReturnedId, setJustReturnedId] = useState(null);

  const [bookForm, setBookForm] = useState({ title: "", author: "", code: "", copies: "1", category: "" });
  const [catalogQuery, setCatalogQuery] = useState("");
  const [editingBookId, setEditingBookId] = useState(null);
  const [editBookForm, setEditBookForm] = useState({ title: "", author: "", copies: "1", category: "" });

  const [studentForm, setStudentForm] = useState({ name: "", className: "CLASS-1", roll: "", phone: "" });
  const [editingStudentId, setEditingStudentId] = useState(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [editForm, setEditForm] = useState({ name: "", className: "", roll: "", phone: "" });
  const [bulkClass, setBulkClass] = useState("CLASS-1");
  const [bulkBooksText, setBulkBooksText] = useState("");
  const [bulkBookCategory, setBulkBookCategory] = useState("");
  const [bulkNames, setBulkNames] = useState("");
  const [bulkStartRoll, setBulkStartRoll] = useState("");
  const [studentListQuery, setStudentListQuery] = useState("");

  const [scannerTarget, setScannerTarget] = useState(null);
  const [scanFeedback, setScanFeedback] = useState(null);
  const [isDesktop, setIsDesktop] = useState(() => typeof window !== "undefined" && window.innerWidth >= 1024);
  const [desktopForceCamera, setDesktopForceCamera] = useState(false);
  const scanLockRef = useRef(false);

  // Search dropdown state
  const [showSearchResults, setShowSearchResults] = useState(false);
  const searchWrapRef = useRef(null);

  // Settings state
  const [appSettings, setAppSettings] = useState(SETTINGS_DEFAULTS);
  const [settingsDraft, setSettingsDraft] = useState(SETTINGS_DEFAULTS);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsSavedMsg, setSettingsSavedMsg] = useState("");

  useEffect(() => {
    const onResize = () => setIsDesktop(window.innerWidth >= 1024);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Close search dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (searchWrapRef.current && !searchWrapRef.current.contains(e.target)) {
        setShowSearchResults(false);
      }
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, []);

  async function handleSignIn(e) {
    e.preventDefault();
    setPwError(""); setSigningIn(true);
    try {
      await signInWithEmailAndPassword(auth, signInEmail.trim(), signInPassword);
      setSignInPassword("");
    } catch { setPwError("Incorrect email or password."); }
    setSigningIn(false);
  }
  async function handleSignOut() { try { await signOut(auth); } catch {} }
  async function handleChangePassword(e) {
    e.preventDefault();
    setChangeError("");
    if (!changeNewPw.trim()) { setChangeError("Enter a new password."); return; }
    if (changeNewPw !== changeNewPw2) { setChangeError("New passwords don't match."); return; }
    try {
      await updatePassword(auth.currentUser, changeNewPw);
      setChangeNewPw(""); setChangeNewPw2(""); setChangeSuccess(true);
    } catch (err) {
      if (err?.code === "auth/requires-recent-login") {
        setChangeError("For security, please sign out and sign in again before changing your password.");
      } else setChangeError("Couldn't update password. Try again.");
    }
  }

  async function saveSettings() {
    setSettingsSaving(true); setSettingsSavedMsg("");
    try {
      await setDoc(doc(db, "settings", "app"), settingsDraft, { merge: true });
      setAppSettings(settingsDraft);
      setSettingsSavedMsg("✅ Settings saved.");
      setTimeout(() => setSettingsSavedMsg(""), 2500);
    } catch (e) {
      setSettingsSavedMsg("❌ Couldn't save. Check your connection.");
    }
    setSettingsSaving(false);
  }

  function downloadCSV(filename, rows) {
    const csv = rows.map((r) =>
      r.map((cell) => {
        const s = String(cell ?? "");
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(",")
    ).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = filename; link.click();
    URL.revokeObjectURL(url);
  }
  function exportBooksCSV() {
    const rows = [["Code", "Title", "Author", "Category", "Total", "Available"]];
    books.forEach((b) => rows.push([b.code, b.title, b.author || "", b.category || "", b.totalCopies, b.availableCopies]));
    downloadCSV(`books_${todayISO()}.csv`, rows);
  }
  function exportStudentsCSV() {
    const rows = [["Name", "Class", "Roll", "Phone", "Books held"]];
    students.forEach((s) => rows.push([s.name, s.className || "", s.roll || "", s.phone || "", studentActiveTx(s.id).length]));
    downloadCSV(`students_${todayISO()}.csv`, rows);
  }
  function exportTransactionsCSV() {
    const rows = [["Book", "Code", "Student", "Class", "Issued", "Due", "Returned", "Status"]];
    transactions.forEach((t) => {
      const book = bookById(t.bookId);
      const st = studentById(t.studentId);
      rows.push([
        book?.title || "", book?.code || "",
        st?.name || "", st?.className || "",
        t.issueDate, t.dueDate, t.returnDate || "",
        t.returnDate ? "Returned" : (t.dueDate < todayISO() ? "Overdue" : "Out"),
      ]);
    });
    downloadCSV(`transactions_${todayISO()}.csv`, rows);
  }

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => { setUser(u); setAuthReady(true); });
    return unsub;
  }, []);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    const unsubs = [];

    unsubs.push(onSnapshot(doc(db, "settings", "classes"), async (snap) => {
      const list = snap.exists() ? snap.data().list : null;
      if (Array.isArray(list) && list.length > 0) setClasses(list);
      else {
        setClasses(DEFAULT_CLASSES);
        try { await setDoc(doc(db, "settings", "classes"), { list: DEFAULT_CLASSES }); } catch {}
      }
    }));
    unsubs.push(onSnapshot(doc(db, "settings", "bookCategories"), async (snap) => {
      const list = snap.exists() ? snap.data().list : null;
      if (Array.isArray(list) && list.length > 0) setCategories(list);
      else {
        setCategories(DEFAULT_CATEGORIES);
        try { await setDoc(doc(db, "settings", "bookCategories"), { list: DEFAULT_CATEGORIES }); } catch {}
      }
    }));
    unsubs.push(onSnapshot(doc(db, "settings", "app"), (snap) => {
      if (snap.exists()) {
        const merged = { ...SETTINGS_DEFAULTS, ...snap.data() };
        setAppSettings(merged);
        setSettingsDraft(merged);
      }
    }));
    unsubs.push(onSnapshot(collection(db, "books"), async (qsnap) => {
      if (qsnap.empty) {
        for (const b of [...SEED_BOOKS, ...NMMI_SEED_BOOKS]) {
          try {
            await setDoc(doc(db, "books", b.code), {
              title: b.title, author: b.author, code: b.code,
              totalCopies: 1, availableCopies: 1,
              category: inferCategoryFromCode(b.code) || "",
            });
          } catch {}
        }
      } else {
        setBooks(qsnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        for (const d of qsnap.docs) {
          const data = d.data();
          if (!data.category) {
            const inferred = inferCategoryFromCode(d.id);
            if (inferred) { try { await updateDoc(doc(db, "books", d.id), { category: inferred }); } catch {} }
          }
        }
      }
    }));
    unsubs.push(onSnapshot(collection(db, "students"), async (qsnap) => {
      if (qsnap.empty) {
        for (const s of SEED_STUDENTS) {
          try { await addDoc(collection(db, "students"), { name: s.name, className: s.className, roll: s.roll }); } catch {}
        }
      } else setStudents(qsnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }));
    unsubs.push(onSnapshot(collection(db, "transactions"), (qsnap) => {
      setTransactions(qsnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }));
    unsubs.push(onSnapshot(doc(db, "settings", "lastPromotion"), (snap) => {
      setLastPromotion(snap.exists() ? snap.data() : null);
    }));

    setLoading(false);
    return () => unsubs.forEach((u) => u && u());
  }, [user]);

  // Hardware scanner keyboard listener (desktop only, when scan expected)
  useEffect(() => {
    if (!isDesktop || !scannerTarget || desktopForceCamera) return;
    let buffer = "", lastKeyTime = 0, resetTimer = null;

    const onKeyDown = (e) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key === "Enter") {
        if (buffer.length > 0) {
          e.preventDefault();
          const code = buffer.trim(); buffer = "";
          if (code && !scanLockRef.current) {
            scanLockRef.current = true;
            handleScanResult(code);
            setTimeout(() => { scanLockRef.current = false; }, 900);
          }
        }
        return;
      }
      if (e.key.length === 1) {
        const now = Date.now();
        if (now - lastKeyTime > 100) buffer = "";
        lastKeyTime = now;
        buffer += e.key;
        clearTimeout(resetTimer);
        resetTimer = setTimeout(() => { buffer = ""; }, 1500);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      clearTimeout(resetTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDesktop, scannerTarget, desktopForceCamera]);

  const activeTx = useMemo(() => transactions.filter((t) => !t.returnDate), [transactions]);
  const overdueTx = useMemo(() => activeTx.filter((t) => t.dueDate < todayISO()), [activeTx]);
  const totalCopies = useMemo(() => books.reduce((s, b) => s + b.totalCopies, 0), [books]);
  const availableCopies = useMemo(() => books.reduce((s, b) => s + b.availableCopies, 0), [books]);

  function bookById(id) { return books.find((b) => b.id === id); }
  function studentById(id) { return students.find((s) => s.id === id); }
  function studentActiveTx(id) { return activeTx.filter((t) => t.studentId === id); }
  function studentHasOverdue(id) { return overdueTx.some((t) => t.studentId === id); }

  async function addClass(e) {
    e.preventDefault();
    const name = newClassName.trim(); if (!name) return;
    if (classes.some((c) => c.toLowerCase() === name.toLowerCase())) { setNewClassName(""); return; }
    try { await setDoc(doc(db, "settings", "classes"), { list: [...classes, name] }); } catch {}
    setNewClassName("");
  }
  function startEditClass(n) { setEditingClassOld(n); setEditClassName(n); }
  function cancelEditClass() { setEditingClassOld(null); }
  async function saveEditClass(e) {
    e.preventDefault();
    const oldName = editingClassOld, newName = editClassName.trim();
    if (!newName || newName === oldName) { setEditingClassOld(null); return; }
    if (classes.some((c) => c !== oldName && c.toLowerCase() === newName.toLowerCase())) return;
    try {
      await setDoc(doc(db, "settings", "classes"), { list: classes.map((c) => (c === oldName ? newName : c)) });
      const q = query(collection(db, "students"), where("className", "==", oldName));
      const snap = await getDocs(q);
      for (const d of snap.docs) { try { await updateDoc(doc(db, "students", d.id), { className: newName }); } catch {} }
    } catch {}
    setEditingClassOld(null);
  }
  async function deleteClass(name) {
    const count = students.filter((s) => s.className === name).length;
    const msg = count > 0 ? `${count} student(s) are in "${name}". Remove the class anyway?` : `Remove class "${name}"?`;
    if (!window.confirm(msg)) return;
    try { await setDoc(doc(db, "settings", "classes"), { list: classes.filter((c) => c !== name) }); } catch {}
  }
  async function addCategory(e) {
    e.preventDefault();
    const name = newCategoryName.trim(); if (!name) return;
    if (categories.some((c) => c.toLowerCase() === name.toLowerCase())) { setNewCategoryName(""); return; }
    try { await setDoc(doc(db, "settings", "bookCategories"), { list: [...categories, name] }); } catch {}
    setNewCategoryName("");
  }
  function startEditCategory(n) { setEditingCategoryOld(n); setEditCategoryName(n); }
  function cancelEditCategory() { setEditingCategoryOld(null); }
  async function saveEditCategory(e) {
    e.preventDefault();
    const oldName = editingCategoryOld, newName = editCategoryName.trim();
    if (!newName || newName === oldName) { setEditingCategoryOld(null); return; }
    if (categories.some((c) => c !== oldName && c.toLowerCase() === newName.toLowerCase())) return;
    try {
      await setDoc(doc(db, "settings", "bookCategories"), { list: categories.map((c) => (c === oldName ? newName : c)) });
      const q = query(collection(db, "books"), where("category", "==", oldName));
      const snap = await getDocs(q);
      for (const d of snap.docs) { try { await updateDoc(doc(db, "books", d.id), { category: newName }); } catch {} }
    } catch {}
    setEditingCategoryOld(null);
  }
  async function deleteCategory(name) {
    const count = books.filter((b) => b.category === name).length;
    const msg = count > 0 ? `${count} book(s) are in "${name}". Remove the category anyway?` : `Remove category "${name}"?`;
    if (!window.confirm(msg)) return;
    try {
      await setDoc(doc(db, "settings", "bookCategories"), { list: categories.filter((c) => c !== name) });
      const q = query(collection(db, "books"), where("category", "==", name));
      const snap = await getDocs(q);
      for (const d of snap.docs) { try { await updateDoc(doc(db, "books", d.id), { category: "" }); } catch {} }
    } catch {}
  }
  async function addBook(e) {
    e.preventDefault();
    if (!bookForm.title.trim() || !bookForm.code.trim()) return;
    const copies = Math.max(1, parseInt(bookForm.copies) || 1);
    const code = stripSpaces(bookForm.code);
    try {
      await setDoc(doc(db, "books", code), {
        title: bookForm.title.trim(), author: bookForm.author.trim(), code,
        totalCopies: copies, availableCopies: copies, category: bookForm.category || "",
      });
    } catch {}
    setBookForm({ title: "", author: "", code: "", copies: "1", category: bookForm.category });
  }
  function startEditBook(b) {
    setEditingBookId(b.id);
    setEditBookForm({ title: b.title, author: b.author || "", copies: String(b.totalCopies), category: b.category || "" });
  }
  function cancelEditBook() { setEditingBookId(null); }
  async function saveEditBook(e) {
    e.preventDefault();
    if (!editBookForm.title.trim()) return;
    const book = books.find((b) => b.id === editingBookId);
    if (!book) return;
    const newTotal = Math.max(1, parseInt(editBookForm.copies) || 1);
    const newAvailable = Math.max(0, newTotal - (book.totalCopies - book.availableCopies));
    try {
      await updateDoc(doc(db, "books", editingBookId), {
        title: editBookForm.title.trim(), author: editBookForm.author.trim(),
        totalCopies: newTotal, availableCopies: newAvailable, category: editBookForm.category || "",
      });
    } catch {}
    setEditingBookId(null);
  }
  async function deleteBook(book) {
    const activeCount = transactions.filter((t) => t.bookId === book.id && !t.returnDate).length;
    if (activeCount > 0) {
      alert(`"${book.title}" is currently issued to ${activeCount} student(s). Get it returned first, then remove it.`);
      return;
    }
    if (!window.confirm(`Remove "${book.title}" (${book.code}) from the catalog?`)) return;
    try { await deleteDoc(doc(db, "books", book.id)); } catch {}
  }
  async function addStudent(e) {
    e.preventDefault();
    if (!studentForm.name.trim() || !studentForm.roll.trim()) return;
    try {
      await addDoc(collection(db, "students"), {
        name: studentForm.name.trim(), className: studentForm.className,
        roll: studentForm.roll.trim(), phone: studentForm.phone.trim(),
      });
    } catch {}
    setStudentForm({ name: "", className: studentForm.className, roll: "", phone: "" });
  }
  function startEditStudent(s) {
    setEditingStudentId(s.id);
    setEditForm({ name: s.name, className: s.className, roll: s.roll, phone: s.phone || "" });
  }
  function cancelEditStudent() { setEditingStudentId(null); }
  async function saveEditStudent(e) {
    e.preventDefault();
    if (!editForm.name.trim()) return;
    try {
      await updateDoc(doc(db, "students", editingStudentId), {
        name: editForm.name.trim(), className: editForm.className,
        roll: editForm.roll.trim(), phone: editForm.phone.trim(),
      });
    } catch {}
    setEditingStudentId(null);
  }
  async function deleteStudent(student) {
    const activeCount = studentActiveTx(student.id).length;
    if (activeCount > 0) {
      alert(`${student.name} currently has ${activeCount} book(s) checked out. Get them returned first, then remove.`);
      return;
    }
    if (!window.confirm(`Remove ${student.name} from the app?`)) return;
    try { await deleteDoc(doc(db, "students", student.id)); } catch {}
    if (detailStudentId === student.id) setSheet(null);
    if (selectedStudentId === student.id) setSelectedStudentId(null);
  }
  async function handlePhotoUpload(e, student) {
    const file = e.target.files && e.target.files[0];
    e.target.value = ""; if (!file) return;
    setPhotoError(""); setPhotoUploading(true);
    try {
      const dataUrl = await resizeImageToDataURL(file);
      await updateDoc(doc(db, "students", student.id), { photoUrl: dataUrl });
    } catch { setPhotoError("Couldn't use that photo. Try a different image."); }
    setPhotoUploading(false);
  }
  async function handleRemovePhoto(student) {
    if (!student.photoUrl) return;
    try { await updateDoc(doc(db, "students", student.id), { photoUrl: null }); } catch {}
  }
  async function addStudentsBulk(e) {
    e.preventDefault();
    let lines = bulkNames.split("\n").map((n) => n.trim()).filter(Boolean);
    if (lines.length === 0) return;
    if (/^name\s*,/i.test(lines[0])) lines = lines.slice(1);
    const startNum = parseInt(bulkStartRoll);
    const hasStart = !isNaN(startNum);
    let autoIdx = 0;
    for (const line of lines) {
      const parts = line.split(",").map((p) => p.trim());
      const name = parts[0]; if (!name) continue;
      const className = parts[1] || bulkClass;
      const roll = parts[2] || (hasStart ? String(startNum + autoIdx) : "");
      const phone = parts[3] || "";
      autoIdx++;
      try { await addDoc(collection(db, "students"), { name, className, roll, phone }); } catch {}
    }
    setBulkNames(""); setBulkStartRoll("");
  }
  async function addBooksBulk(e) {
    e.preventDefault();
    let lines = bulkBooksText.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return;
    if (/^code\s*,/i.test(lines[0])) lines = lines.slice(1);
    for (const line of lines) {
      const parts = line.split(",").map((p) => p.trim());
      const code = stripSpaces(parts[0]); const title = parts[1];
      if (!code || !title) continue;
      const author = parts[2] || "";
      const copies = Math.max(1, parseInt(parts[3]) || 1);
      const category = parts[4] || bulkBookCategory || "";
      try {
        await setDoc(doc(db, "books", code), {
          title, author, code, totalCopies: copies, availableCopies: copies, category,
        });
      } catch {}
    }
    setBulkBooksText("");
  }
  async function issueBook() {
    if (!selectedStudentId || !selectedBook || selectedBook.availableCopies < 1) return;
    const maxBooks = appSettings.maxBooksPerStudent || 0;
    if (maxBooks > 0) {
      const held = studentActiveTx(selectedStudentId).length;
      if (held >= maxBooks) {
        const st = studentById(selectedStudentId);
        alert(`${st?.name || "This student"} already has ${held} book(s) — the limit is ${maxBooks}.`);
        return;
      }
    }
    const issueDate = todayISO();
    const loanDays = appSettings.defaultLoanDays || 14;
    const dueDate = addDays(issueDate, Math.max(1, parseInt(days) || loanDays));
    try {
      await addDoc(collection(db, "transactions"), {
        bookId: selectedBook.id, studentId: selectedStudentId, issueDate, dueDate, returnDate: null,
      });
      await updateDoc(doc(db, "books", selectedBook.id), {
        availableCopies: selectedBook.availableCopies - 1,
      });
    } catch {}
    const st = studentById(selectedStudentId);
    setLastIssued({ bookTitle: selectedBook.title, studentName: st ? st.name : "", dueDate });
    setSelectedBook(null); setBookQuery("");
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
    } catch {}
    setJustReturnedId(txId);
    setTimeout(() => setJustReturnedId((cur) => (cur === txId ? null : cur)), 1500);
  }

  const bookMatchForSearch = useMemo(() => {
    const q = normCode(homeQuery);
    if (!q) return null;
    return books.find((b) => normCode(b.code) === q || normCode(b.code).includes(q)) || null;
  }, [homeQuery, books]);

  const searchStudentMatches = useMemo(() => {
    const q = homeQuery.trim().toLowerCase();
    if (!q) return [];
    return students.filter((s) => s.name.toLowerCase().includes(q) || (s.roll || "").toLowerCase().includes(q)).slice(0, 5);
  }, [homeQuery, students]);

  const searchBookMatches = useMemo(() => {
    const q = homeQuery.trim().toLowerCase();
    if (!q) return [];
    return books.filter((b) => (b.title || "").toLowerCase().includes(q) || (b.author || "").toLowerCase().includes(q) || normCode(b.code).includes(normCode(q))).slice(0, 5);
  }, [homeQuery, books]);

  const filteredStudents = useMemo(() => {
    let list = students;
    if (selectedClass !== "ALL") list = list.filter((s) => s.className === selectedClass);
    const q = homeQuery.trim().toLowerCase();
    if (q) list = list.filter((s) => s.name.toLowerCase().includes(q) || s.roll.toLowerCase().includes(q));
    return list;
  }, [students, selectedClass, homeQuery]);

  const issueBookMatches = useMemo(() => {
    const q = bookQuery.trim().toLowerCase();
    if (!q) return books.slice(0, 6);
    return books.filter((b) => b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q) || normCode(b.code).includes(normCode(q))).slice(0, 6);
  }, [bookQuery, books]);

  const issueStudentMatches = useMemo(() => {
    const q = issueStudentQuery.trim().toLowerCase();
    if (!q) return students.slice(0, 6);
    return students.filter((s) => s.name.toLowerCase().includes(q) || s.roll.toLowerCase().includes(q)).slice(0, 6);
  }, [issueStudentQuery, students]);

  const returnSearchMatches = useMemo(() => {
    const q = returnQuery.trim().toLowerCase();
    const list = activeTx.map((t) => ({ tx: t, book: bookById(t.bookId), student: studentById(t.studentId) })).filter((r) => r.book && r.student);
    if (!q) return list.sort((a, b) => (a.tx.dueDate < b.tx.dueDate ? -1 : 1));
    return list.filter((r) => r.book.title.toLowerCase().includes(q) || r.student.name.toLowerCase().includes(q) || r.book.code.toLowerCase().includes(q)).sort((a, b) => (a.tx.dueDate < b.tx.dueDate ? -1 : 1));
  }, [returnQuery, activeTx, books, students]);

  const catalogMatches = useMemo(() => {
    const q = catalogQuery.trim().toLowerCase();
    if (!q) return books;
    return books.filter((b) => b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q) || normCode(b.code).includes(normCode(q)));
  }, [catalogQuery, books]);

  const catalogGrouped = useMemo(() => {
    const groups = {};
    catalogMatches.forEach((b) => {
      const cat = b.category && b.category.trim() ? b.category : UNCATEGORIZED;
      (groups[cat] = groups[cat] || []).push(b);
    });
    const ordered = [];
    categories.forEach((c) => { if (groups[c]) { ordered.push([c, groups[c]]); delete groups[c]; } });
    Object.keys(groups).sort().forEach((c) => ordered.push([c, groups[c]]));
    return ordered;
  }, [catalogMatches, categories]);

  const monthlyTopReaders = useMemo(() => {
    if (!certMonth) return [];
    const counts = {};
    transactions.forEach((t) => {
      if (t.issueDate && t.issueDate.startsWith(certMonth)) counts[t.studentId] = (counts[t.studentId] || 0) + 1;
    });
    return Object.entries(counts).map(([studentId, count]) => ({ student: studentById(studentId), count }))
      .filter((x) => x.student).sort((a, b) => b.count - a.count);
  }, [certMonth, transactions, students]);

  const certStudent = certStudentId ? studentById(certStudentId) : (monthlyTopReaders[0] ? monthlyTopReaders[0].student : null);
  const certCount = certStudent ? (monthlyTopReaders.find((x) => x.student.id === certStudent.id) || { count: 0 }).count : 0;

  const dashboardStats = useMemo(() => {
    const bookCounts = {}; const studentCounts = {};
    transactions.forEach((t) => {
      bookCounts[t.bookId] = (bookCounts[t.bookId] || 0) + 1;
      studentCounts[t.studentId] = (studentCounts[t.studentId] || 0) + 1;
    });
    const mostBorrowed = books.map((b) => ({ book: b, count: bookCounts[b.id] || 0 })).filter((x) => x.count > 0).sort((a, b) => b.count - a.count).slice(0, 5);
    const neverBorrowed = books.filter((b) => !bookCounts[b.id]);
    const topReaders = students.map((s) => ({ student: s, count: studentCounts[s.id] || 0 })).filter((x) => x.count > 0).sort((a, b) => b.count - a.count).slice(0, 5);
    const classCounts = {};
    students.forEach((s) => {
      const cls = s.className && s.className.trim() ? s.className : "Unassigned";
      classCounts[cls] = (classCounts[cls] || 0) + (studentCounts[s.id] || 0);
    });
    const topClasses = Object.entries(classCounts).filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1]).slice(0, 5);
    return { mostBorrowed, neverBorrowed, topReaders, topClasses };
  }, [books, students, transactions]);

  const overdueList = useMemo(() => {
    return overdueTx.map((t) => ({ tx: t, book: bookById(t.bookId), student: studentById(t.studentId) }))
      .filter((r) => r.book && r.student).sort((a, b) => (a.tx.dueDate < b.tx.dueDate ? -1 : 1));
  }, [overdueTx, books, students]);

  const selectedStudent = selectedStudentId ? studentById(selectedStudentId) : null;

  function openIssue() {
    setIssueStudentQuery(""); setBookQuery(""); setSelectedBook(null); setLastIssued(null);
    setDays(appSettings.defaultLoanDays || 14);
    setSheet("issue");
  }
  function openReturn() { setReturnQuery(""); setSheet("return"); }

  function openScanner(target) {
    setDesktopForceCamera(false);
    setScannerTarget(target);
  }

  function handleScanResult(text) {
    const val = (text || "").trim();
    const bookCode = parseBookQrValue(val);
    let feedback = { type: "error", message: "Not found" };

    if (scannerTarget === "home") {
      const studentMatch = students.find((s) => s.roll.toLowerCase() === val.toLowerCase());
      const bookMatch = books.find((b) => normCode(b.code) === normCode(bookCode));
      if (studentMatch) {
        feedback = { type: "success" }; setHomeQuery(""); openStudentDetail(studentMatch.id);
      } else if (bookMatch) {
        feedback = { type: "success" }; setHomeQuery(bookMatch.code);
        setDetailBookId(bookMatch.id); setSheet("bookDetail");
      } else setHomeQuery(val);
    } else if (scannerTarget === "issueBook") {
      setBookQuery(bookCode);
      const match = books.find((b) => normCode(b.code) === normCode(bookCode));
      if (match && match.availableCopies > 0) { setSelectedBook(match); feedback = { type: "success" }; }
      else if (match) feedback = { type: "warning", message: "Already issued" };
    } else if (scannerTarget === "issueStudent") {
      setIssueStudentQuery(val);
      const match = students.find((s) => s.roll.toLowerCase() === val.toLowerCase());
      if (match) { setSelectedStudentId(match.id); feedback = { type: "success" }; }
    } else if (scannerTarget === "return") {
      setReturnQuery(bookCode);
      const hasMatch = books.some((b) => normCode(b.code) === normCode(bookCode)) ||
        students.some((s) => s.roll.toLowerCase() === val.toLowerCase() || s.name.toLowerCase().includes(val.toLowerCase()));
      if (hasMatch) feedback = { type: "success" };
    }

    playScanSound(feedback.type);
    setScanFeedback(feedback);
    setTimeout(() => {
      setScanFeedback(null);
      setScannerTarget(null);
    }, feedback.type === "success" ? 450 : 750);
  }

  function openPromotion() {
    const m = {};
    classes.forEach((c, i) => { m[c] = classes[i + 1] || ""; });
    setPromoMap(m); setPromoMsg(""); setSheet("promotion");
  }
  async function applyPromotion() {
    const moves = [];
    students.forEach((s) => {
      if (!s.className || !(s.className in promoMap)) return;
      const to = promoMap[s.className];
      if (to !== s.className) moves.push({ id: s.id, from: s.className, to });
    });
    if (moves.length === 0) { setPromoMsg("No student will change class."); return; }
    if (!window.confirm(`Move ${moves.length} students to their new classes?`)) return;
    setPromoBusy(true); setPromoMsg("");
    try {
      for (let i = 0; i < moves.length; i += 400) {
        const batch = writeBatch(db);
        moves.slice(i, i + 400).forEach((m) => batch.update(doc(db, "students", m.id), { className: m.to }));
        await batch.commit();
      }
      await setDoc(doc(db, "settings", "lastPromotion"), { date: todayISO(), moves });
      setPromoMsg(`✅ ${moves.length} students moved. You can undo this below.`);
    } catch { setPromoMsg("Couldn't finish — check your internet connection and look at the student list."); }
    setPromoBusy(false);
  }
  async function undoPromotion() {
    if (!lastPromotion || !Array.isArray(lastPromotion.moves)) return;
    const byId = {}; students.forEach((s) => { byId[s.id] = s; });
    const revert = lastPromotion.moves.filter((m) => byId[m.id] && byId[m.id].className === m.to);
    if (revert.length === 0) { setPromoMsg("Nothing to undo — those students were changed again since."); return; }
    if (!window.confirm(`Undo the last promotion? ${revert.length} students go back.`)) return;
    setPromoBusy(true); setPromoMsg("");
    try {
      for (let i = 0; i < revert.length; i += 400) {
        const batch = writeBatch(db);
        revert.slice(i, i + 400).forEach((m) => batch.update(doc(db, "students", m.id), { className: m.from }));
        await batch.commit();
      }
      await deleteDoc(doc(db, "settings", "lastPromotion"));
      setPromoMsg(`↩️ ${revert.length} students moved back.`);
    } catch { setPromoMsg("Couldn't undo — check your internet connection and try again."); }
    setPromoBusy(false);
  }

  function openStudentDetail(id) { setDetailStudentId(id); setSheet("studentDetail"); }
  function openIdCard(id) { setDetailStudentId(id); setSheet("idCard"); }
  function openBookDetail(id) { setDetailBookId(id); setSheet("bookDetail"); }

  async function downloadCard(student) {
    if (!cardRef.current) return;
    setCardDownloading(true);
    try {
      const canvas = await html2canvas(cardRef.current, { scale: 3, backgroundColor: null });
      const link = document.createElement("a");
      link.download = `${student.name.replace(/\s+/g, "_")}_library_card.png`;
      link.href = canvas.toDataURL("image/png"); link.click();
    } catch { alert("Couldn't create the image. Try taking a screenshot instead."); }
    setCardDownloading(false);
  }
  async function downloadCertificate(student, month) {
    if (!certRef.current) return;
    setCertDownloading(true);
    try {
      const canvas = await html2canvas(certRef.current, { scale: 3, backgroundColor: null });
      const link = document.createElement("a");
      link.download = `${student.name.replace(/\s+/g, "_")}_certificate_${month}.png`;
      link.href = canvas.toDataURL("image/png"); link.click();
    } catch { alert("Couldn't create the image. Try taking a screenshot instead."); }
    setCertDownloading(false);
  }
  function openAddStudent() {
    const defaultClass = selectedClass !== "ALL" ? selectedClass : classes[0] || "CLASS-1";
    setStudentForm({ name: "", className: defaultClass, roll: "" });
    setBulkClass(defaultClass); setBulkNames(""); setBulkStartRoll("");
    setEditingStudentId(null); setStudentListQuery(""); setSheet("addStudent");
  }

  const studentListForManage = useMemo(() => {
    const q = studentListQuery.trim().toLowerCase();
    if (!q) return students;
    return students.filter((s) => s.name.toLowerCase().includes(q) || s.roll.toLowerCase().includes(q));
  }, [students, studentListQuery]);

  return (
    <div className={`app ${appSettings.darkMode ? "dark" : ""}`}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;800&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
        :root {
          --navy:#1B4D3E;--navy-deep:#0F3328;--maroon:#8B2E3C;--sky:#C9A227;--gold-soft:#E7C989;
          --green:#2F9E6E;--row-bg:#FBF2D9;--indigo:#2C6E5C;--page-bg:#FDF8ED;--text:#2B2420;
          --text-soft:#7A6F5D;--search-bg:#EFE6D2;--danger:#B5302A;--line:#E8DCC0;
          --shadow-sm:0 1px 3px rgba(43,36,32,0.08),0 1px 2px rgba(43,36,32,0.06);
          --shadow-md:0 4px 12px rgba(27,77,62,0.12),0 2px 4px rgba(27,77,62,0.08);
        }
        * { box-sizing: border-box; }
        html,body { margin:0; padding:0; }
        .app { font-family:'Inter',sans-serif;background:var(--page-bg);color:var(--text);min-height:100vh;max-width:480px;margin:0 auto;padding-bottom:6rem;position:relative; }
        .mono { font-family:'JetBrains Mono',monospace; }
        .top-fixed {
          position:sticky;top:0;z-index:20;background-color:var(--page-bg);
          background-image:
            linear-gradient(45deg,rgba(201,162,39,0.07) 25%,transparent 25%),
            linear-gradient(-45deg,rgba(201,162,39,0.07) 25%,transparent 25%),
            linear-gradient(45deg,transparent 75%,rgba(201,162,39,0.07) 75%),
            linear-gradient(-45deg,transparent 75%,rgba(201,162,39,0.07) 75%);
          background-size:26px 26px;background-position:0 0,0 13px,13px -13px,-13px 0;
          padding-top:env(safe-area-inset-top,0px);
          box-shadow:0 2px 8px rgba(27,77,62,0.08);border-bottom:2px solid var(--sky);
        }
        .header { display:flex;align-items:flex-start;justify-content:space-between;padding:1.1rem 1.1rem .7rem; }
        .brand h1 { font-family:'Playfair Display',serif;font-weight:800;font-size:1.5rem;color:var(--navy);margin:0;line-height:1.1; }
        .brand .sub { font-size:.72rem;color:var(--maroon);font-weight:500;margin-top:.15rem; }
        .desktop-title { display:none; }
        .desktop-title h1 { font-family:'Playfair Display',serif;font-weight:800;font-size:1.7rem;color:var(--navy);margin:0;line-height:1.15; }
        .desktop-title .sub { font-size:.82rem;color:var(--text-soft);margin-top:.25rem; }
        .sidebar { display:none; }
        .icon-btn { background:transparent;border:none;color:var(--text);cursor:pointer;padding:.3rem;border-radius:6px; }
        .icon-btn:hover { background:#F0F0F0; }
        .icon-btn:focus-visible { outline:2px solid var(--indigo);outline-offset:1px; }
        .search-wrap { margin:0 1.1rem .8rem;position:relative; }
        .search-wrap .icon { position:absolute;left:.8rem;top:50%;transform:translateY(-50%);color:var(--text-soft);z-index:1; }
        .search-wrap input {
          width:100%;background:var(--search-bg);border:none;border-radius:999px;
          padding:.7rem .9rem .7rem 2.3rem;font-size:.92rem;font-family:'Inter',sans-serif;color:var(--text);
          transition:box-shadow .15s ease;
        }
        .search-wrap input:focus-visible { outline:none;box-shadow:0 0 0 2px var(--indigo),var(--shadow-sm); }
        .search-wrap input.with-scan { padding-right:2.7rem; }
        .scan-btn {
          position:absolute;right:.35rem;top:50%;transform:translateY(-50%);
          background:var(--indigo);color:#fff;border:none;border-radius:50%;
          width:30px;height:30px;display:flex;align-items:center;justify-content:center;cursor:pointer;flex:0 0 auto;
        }
        .scan-btn:focus-visible { outline:2px solid var(--navy);outline-offset:2px; }
        .scan-row { display:flex;gap:.5rem;align-items:stretch; }
        .scan-row input { flex:1;min-width:0; }
        .scan-btn-inline {
          background:var(--indigo);color:#fff;border:none;border-radius:6px;padding:0 .8rem;
          display:flex;align-items:center;justify-content:center;cursor:pointer;flex:0 0 auto;
        }
        .scan-btn-inline:focus-visible { outline:2px solid var(--navy);outline-offset:2px; }
        .scanner-video-wrap { position:relative;width:100%;aspect-ratio:3/4;background:#000;border-radius:10px;overflow:hidden;margin-bottom:.8rem; }
        .scanner-video { width:100%;height:100%;object-fit:cover;display:block; }
        .scanner-frame { position:absolute;top:20%;left:10%;right:10%;bottom:30%;border:3px solid var(--sky);border-radius:10px;pointer-events:none; }
        .scan-flash { position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.6rem;z-index:5;animation:scanFlashPop .22s ease-out; }
        .scan-flash-success { background:rgba(31,138,94,.9); }
        .scan-flash-warning { background:rgba(217,149,19,.92); }
        .scan-flash-error { background:rgba(192,57,43,.92); }
        .scan-flash-msg { color:#fff;font-weight:700;font-size:.92rem;text-align:center;padding:0 1.2rem; }
        @keyframes scanFlashPop { 0%{opacity:0;transform:scale(.92);}100%{opacity:1;transform:scale(1);} }
        @media (prefers-reduced-motion:reduce) { .scan-flash { animation:none; } }
        .pulse-icon {
          display:inline-flex;align-items:center;justify-content:center;
          width:110px;height:110px;border-radius:50%;
          background:linear-gradient(135deg,#EAF2FB 0%,#C9DFF5 100%);color:var(--navy);
          animation:pulseRing 1.8s ease-in-out infinite;
        }
        @keyframes pulseRing { 0%,100%{box-shadow:0 0 0 0 rgba(44,110,92,.45);}50%{box-shadow:0 0 0 22px rgba(44,110,92,0);} }
        @media (prefers-reduced-motion:reduce) { .pulse-icon { animation:none; } }
        .scan-feedback-inline { display:flex;flex-direction:column;align-items:center;gap:.6rem;padding:1.4rem .5rem;animation:scanFlashPop .22s ease-out; }
        .scan-feedback-success { color:#1F8A5E; }
        .scan-feedback-warning { color:#D99513; }
        .scan-feedback-error { color:var(--danger); }
        .scan-feedback-msg { font-weight:700;font-size:.92rem; }
        .search-results {
          position:absolute;top:calc(100% + .4rem);left:0;right:0;background:#fff;
          border-radius:12px;box-shadow:0 8px 30px rgba(27,77,62,.2);
          max-height:60vh;overflow-y:auto;z-index:40;padding:.4rem;border:1px solid var(--line);
        }
        .search-section { margin-bottom:.4rem; }
        .search-section:last-child { margin-bottom:0; }
        .search-section-title {
          font-size:.68rem;font-weight:700;color:var(--text-soft);text-transform:uppercase;
          letter-spacing:.05em;padding:.5rem .6rem .3rem;display:flex;align-items:center;gap:.35rem;
        }
        .search-result-item {
          display:flex;align-items:center;gap:.6rem;width:100%;padding:.55rem .6rem;
          border:none;background:transparent;border-radius:8px;cursor:pointer;text-align:left;transition:background .12s ease;
        }
        .search-result-item:hover { background:var(--row-bg); }
        .search-result-item:focus-visible { outline:2px solid var(--indigo);outline-offset:-2px; }
        .sr-title { font-weight:600;font-size:.88rem;color:var(--text);line-height:1.3; }
        .sr-meta { font-size:.72rem;color:var(--text-soft);margin-top:.08rem; }
        .sr-icon { width:32px;height:32px;border-radius:8px;background:var(--indigo);color:#fff;display:flex;align-items:center;justify-content:center;flex:0 0 auto; }
        .search-no-results { text-align:center;padding:1.2rem .8rem;color:var(--text-soft);font-size:.86rem; }
        .book-hint { margin:-.2rem 1.1rem .8rem;background:#EAF2FB;border:1px solid #C9DFF5;border-radius:8px;padding:.55rem .75rem;font-size:.8rem;color:var(--navy); }
        .class-row { display:flex;gap:.5rem;overflow-x:auto;margin:0 1.1rem 1rem;padding:.4rem .5rem;border:1px solid var(--line);border-radius:999px;background:#FFF; }
        .class-chip {
          flex:0 0 auto;background:var(--sky);color:#fff;border:none;border-radius:999px;
          padding:.45rem .95rem;font-size:.82rem;font-weight:700;cursor:pointer;white-space:nowrap;opacity:.55;
          transition:opacity .15s ease,box-shadow .15s ease,transform .1s ease;
        }
        .class-chip.active { opacity:1;box-shadow:0 0 0 2px rgba(27,77,62,.25),var(--shadow-sm); }
        .class-chip:active { transform:scale(.95); }
        .class-chip:focus-visible { outline:2px solid var(--navy);outline-offset:2px; }
        .student-list { padding:0 1.1rem;display:flex;flex-direction:column;gap:.5rem; }
        .student-row {
          display:flex;align-items:center;background:var(--row-bg);border-radius:12px;
          padding:.4rem .4rem .4rem .9rem;border:2px solid transparent;width:100%;
          box-shadow:var(--shadow-sm);transition:box-shadow .15s ease,transform .1s ease;
        }
        .student-row:active { transform:scale(.99); }
        .student-row.selected { border-color:var(--indigo);box-shadow:var(--shadow-md); }
        .student-row-main {
          display:flex;align-items:center;gap:.9rem;flex:1;min-width:0;
          background:none;border:none;padding:.4rem 0;margin:0;cursor:pointer;text-align:left;
        }
        .student-row-main:focus-visible { outline:2px solid var(--indigo);outline-offset:2px; }
        .row-view-btn {
          background:none;border:none;color:var(--text-soft);cursor:pointer;
          padding:.5rem;flex:0 0 auto;border-radius:50%;display:flex;
        }
        .row-view-btn:hover { background:rgba(0,0,0,.06);color:var(--navy); }
        .row-view-btn:focus-visible { outline:2px solid var(--indigo);outline-offset:2px; }
        .avatar {
          width:42px;height:42px;border-radius:50%;background:var(--green);flex:0 0 auto;position:relative;
          display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;
          box-shadow:0 0 0 3px #FAF6EC,0 0 0 4px var(--line),var(--shadow-sm);
        }
        .avatar .dot-badge { position:absolute;top:-3px;right:-3px;width:12px;height:12px;border-radius:50%;background:var(--danger);border:2px solid #fff; }
        .avatar .check-badge { position:absolute;bottom:-2px;right:-2px;width:16px;height:16px;border-radius:50%;background:var(--indigo);display:flex;align-items:center;justify-content:center;border:2px solid #fff; }
        .avatar-img { width:100%;height:100%;object-fit:cover;display:block;border-radius:50%; }
        .avatar-letter { line-height:1;user-select:none; }
        .student-name { font-size:1.02rem;font-weight:600;color:var(--text); }
        .student-meta { font-size:.76rem;color:var(--text-soft);margin-top:.1rem; }
        .empty { text-align:center;padding:2.2rem 1rem;color:var(--text-soft);font-size:.9rem; }
        .bottom-bar {
          position:fixed;bottom:1rem;left:50%;transform:translateX(-50%);
          width:calc(100% - 2.2rem);max-width:440px;background:#fff;border-radius:999px;
          box-shadow:0 6px 18px rgba(0,0,0,.15);display:flex;justify-content:space-around;
          padding:.6rem .5rem;z-index:15;
        }
        .bottom-item { display:flex;flex-direction:column;align-items:center;gap:.3rem;background:transparent;border:none;cursor:pointer;color:var(--text); }
        .bottom-item:focus-visible { outline:2px solid var(--indigo);outline-offset:2px;border-radius:8px; }
        .bottom-dot {
          width:34px;height:34px;border-radius:50%;background:var(--indigo);color:#fff;
          display:flex;align-items:center;justify-content:center;box-shadow:var(--shadow-sm);
          transition:transform .12s ease,box-shadow .15s ease;
        }
        .bottom-item:active .bottom-dot { transform:scale(.88); }
        .bottom-item .label { font-size:.68rem;font-weight:700;letter-spacing:.02em; }
        @keyframes modalFadeIn { from{opacity:0;}to{opacity:1;} }
        @keyframes modalSlideUp { from{transform:translateY(28px);opacity:0;}to{transform:translateY(0);opacity:1;} }
        .modal-backdrop { position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:flex-end;justify-content:center;z-index:50;animation:modalFadeIn .18s ease; }
        .modal-panel {
          background:#fff;width:100%;max-width:480px;max-height:85vh;overflow-y:auto;
          border-radius:18px 18px 0 0;padding:1rem 1.1rem 1.4rem;
          box-shadow:0 -8px 30px rgba(27,77,62,.18);
          animation:modalSlideUp .24s cubic-bezier(.16,1,.3,1);
        }
        @media (prefers-reduced-motion:reduce) { .modal-backdrop,.modal-panel { animation:none; } }
        @media (min-width:540px) { .modal-backdrop { align-items:center; } .modal-panel { border-radius:14px;max-height:80vh; } }
        .modal-head { display:flex;justify-content:space-between;align-items:center;margin-bottom:.8rem; }
        .modal-head h2 { font-family:'Playfair Display',serif;font-size:1.15rem;color:var(--navy);margin:0; }
        .menu-list { display:flex;flex-direction:column;gap:.4rem; }
        .menu-row {
          display:flex;align-items:center;gap:.7rem;padding:.75rem .5rem;border-radius:8px;
          background:#F7F7F7;border:none;cursor:pointer;font-size:.92rem;font-weight:600;color:var(--text);
          width:100%;text-align:left;
        }
        .menu-row:hover { background:#EFEFEF; }
        label { display:block;font-size:.8rem;color:var(--text-soft);margin-bottom:.3rem; }
        input[type="text"],input[type="number"],input[type="search"],input[type="month"],input[type="email"],input[type="password"],input[type="tel"],select,textarea {
          width:100%;font-family:'Inter',sans-serif;font-size:.92rem;padding:.55rem .7rem;
          border:1px solid #DDD;border-radius:6px;background:#FAFAFA;color:var(--text);
        }
        input:focus-visible,select:focus-visible,textarea:focus-visible { outline:2px solid var(--indigo);border-color:var(--indigo); }
        .field { margin-bottom:.7rem; }
        .form-grid { display:grid;grid-template-columns:1fr 1fr;gap:.7rem;margin-bottom:.7rem; }
        .btn {
          font-family:'Inter',sans-serif;font-weight:700;font-size:.9rem;background:var(--navy);color:#fff;
          border:none;border-radius:9px;padding:.6rem 1.1rem;cursor:pointer;display:inline-flex;
          align-items:center;gap:.4rem;box-shadow:var(--shadow-sm);
          transition:transform .1s ease,box-shadow .15s ease,background .15s ease;
        }
        .btn:active { transform:scale(.97); }
        .btn:disabled { background:#B9AF98;box-shadow:none;cursor:not-allowed; }
        .btn:focus-visible { outline:2px solid var(--indigo);outline-offset:2px; }
        .btn.secondary { background:transparent;color:var(--navy);border:1px solid var(--navy); }
        .btn.full { width:100%;justify-content:center; }
        .pick-list { display:flex;flex-direction:column;gap:.4rem;margin-bottom:.9rem;max-height:220px;overflow-y:auto; }
        .pick-item {
          display:flex;justify-content:space-between;align-items:center;background:#FAFAFA;
          border:1px solid #E5E5E5;border-radius:7px;padding:.55rem .75rem;cursor:pointer;width:100%;text-align:left;
        }
        .pick-item:hover,.pick-item.selected { border-color:var(--indigo);background:#EDEEFB; }
        .pick-item .t-title { font-weight:700;font-size:.88rem; }
        .pick-item .t-meta { font-size:.74rem;color:var(--text-soft); }
        .pick-item .badge { font-family:'JetBrains Mono',monospace;font-size:.7rem;color:var(--navy);background:#E4EFFB;padding:.15rem .4rem;border-radius:4px; }
        .current-pick {
          display:flex;justify-content:space-between;align-items:center;background:#EDEEFB;
          border:1px solid var(--indigo);border-radius:7px;padding:.5rem .75rem;margin-bottom:.7rem;font-size:.86rem;
        }
        .current-pick button { background:none;border:none;color:var(--indigo);font-weight:700;cursor:pointer;font-size:.78rem; }
        .stamp-card { margin-top:1rem;background:#FFF;border:1px dashed var(--danger);border-radius:8px;padding:.9rem;display:flex;align-items:center;gap:.9rem; }
        .stamp-mark {
          border:3px solid var(--danger);color:var(--danger);border-radius:8px;padding:.45rem .8rem;
          transform:rotate(-6deg);animation:stampIn .35s ease-out;text-align:center;flex:0 0 auto;
        }
        .stamp-mark .l1 { font-weight:800;font-size:.78rem;text-transform:uppercase;letter-spacing:.04em; }
        .stamp-mark .l2 { font-family:'JetBrains Mono',monospace;font-weight:700;font-size:.95rem; }
        @keyframes stampIn { 0%{transform:rotate(-6deg) scale(2.2);opacity:0;}70%{opacity:1;}100%{transform:rotate(-6deg) scale(1);opacity:1;} }
        @media (prefers-reduced-motion:reduce) { .stamp-mark { animation:none; } }
        .stamp-info { font-size:.84rem;color:var(--text-soft); }
        .stamp-info b { color:var(--text); }
        .row-list { display:flex;flex-direction:column;gap:.5rem; }
        .row-card {
          display:flex;justify-content:space-between;align-items:center;gap:.6rem;background:#FAF6EC;
          border:1px solid var(--line);border-radius:10px;padding:.6rem .8rem;box-shadow:var(--shadow-sm);
          transition:box-shadow .15s ease,transform .15s ease;
        }
        .row-card.overdue { border-color:var(--danger);background:#F8E9E7; }
        .row-card .title { font-weight:700;font-size:.88rem; }
        .row-card .meta { font-size:.74rem;color:var(--text-soft); }
        .row-card .due { font-family:'JetBrains Mono',monospace;font-size:.78rem; }
        .row-card.overdue .due { color:var(--danger);font-weight:700; }
        .returned-flash { font-size:.78rem;color:#1F8A5E;font-weight:700;display:flex;align-items:center;gap:.25rem; }
        table { width:100%;border-collapse:collapse; }
        th,td { text-align:left;padding:.5rem .35rem;border-bottom:1px solid #EEE;font-size:.82rem; }
        th { color:var(--text-soft);font-weight:700;font-size:.72rem; }
        .grid-stats { display:grid;grid-template-columns:1fr 1fr;gap:.7rem;margin-bottom:1rem; }
        .stat-card { background:#FAF6EC;border:1px solid var(--line);border-top:3px solid var(--sky);border-radius:10px;padding:.75rem .85rem;box-shadow:var(--shadow-sm); }
        .stat-card.warn { border-top-color:var(--danger); }
        .stat-card .num { font-family:'JetBrains Mono',monospace;font-size:1.4rem;font-weight:700;color:var(--navy); }
        .stat-card.warn .num { color:var(--danger); }
        .stat-card .label { font-size:.78rem;color:var(--text-soft);margin-top:.1rem; }
        .dash-heading { font-family:'Playfair Display',serif;font-size:.95rem;color:var(--navy);margin:1.1rem 0 .5rem;display:flex;align-items:baseline;gap:.4rem; }
        .dash-heading:first-of-type { margin-top:.2rem; }
        .dash-heading .dash-sub { font-family:'Inter',sans-serif;font-weight:400;font-size:.74rem;color:var(--text-soft); }
        .rank { font-family:'JetBrains Mono',monospace;font-weight:700;color:var(--navy);width:26px;flex:0 0 auto;text-align:center;font-size:.88rem; }
        .dash-row { display:flex;align-items:center;gap:.6rem; }
        .lock-screen { position:fixed;inset:0;z-index:100;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2rem 1.3rem;text-align:center;overflow-y:auto;background:var(--page-bg); }
        .lock-icon { width:56px;height:56px;border-radius:50%;background:var(--navy);color:#fff;display:flex;align-items:center;justify-content:center;margin-bottom:1rem; }
        .lock-screen h1 { font-family:'Playfair Display',serif;font-weight:800;font-size:1.3rem;color:var(--navy);margin:0 0 .15rem; }
        .lock-screen .sub { font-size:.74rem;color:var(--maroon);margin-bottom:1.6rem; }
        .lock-form { width:100%;max-width:320px;text-align:left; }
        .lock-form .field { margin-bottom:.8rem; }
        .lock-error { color:var(--danger);font-size:.82rem;font-weight:600;margin-bottom:.7rem;text-align:center; }
        .lock-hint { font-size:.76rem;color:var(--text-soft);margin-top:1rem;text-align:center; }
        .print-area { display:grid;grid-template-columns:1fr 1fr;gap:.6rem; }
        .print-area.books-print { grid-template-columns: repeat(4, 1fr); }
        .id-card { border:1px solid var(--line);border-radius:8px;padding:.5rem;text-align:center;background:#fff; }
        .book-label-card {
  padding: 0.2rem;
  border: 1px dashed #ccc; /* പ്രിൻ്റ് ചെയ്ത് മുറിക്കാൻ വേണ്ടി */
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
.book-label-code {
  font-family: 'JetBrains Mono', monospace;
  font-weight: 700;
  font-size: 0.75rem;
  margin-bottom: 0.1rem;
  color: var(--text);
}
        .id-card-name { font-weight:700;font-size:.72rem;color:var(--text);line-height:1.25; }
        .id-card-meta { font-size:.62rem;color:var(--text-soft);margin-bottom:.3rem;line-height:1.25; }
        .id-qrcode { width:100%;max-width:110px;height:auto;margin:0 auto;display:block; }
        .id-card-wrap { display:flex;justify-content:center;padding:.4rem 0 .2rem; }
        .lib-card {
          width:320px;max-width:100%;background:linear-gradient(135deg,#FDF8ED 0%,#FBF2D9 100%);
          border:3px solid var(--sky);border-radius:16px;overflow:hidden;box-shadow:var(--shadow-md);
          display:flex;flex-direction:column;
        }
        .lib-card-top { background:var(--navy);background-image:linear-gradient(135deg,var(--navy) 0%,var(--navy-deep) 100%);padding:.65rem .9rem;color:#fff; }
        .lib-card-brand-name { font-family:'Playfair Display',serif;font-weight:800;font-size:.95rem;letter-spacing:.02em; }
        .lib-card-brand-sub { font-size:.6rem;color:var(--gold-soft);margin-top:.15rem; }
        .lib-card-body { display:flex;align-items:center;gap:.8rem;padding:.9rem;flex:1; }
        .lib-card-info { flex:1;min-width:0; }
        .lib-card-name { font-family:'Playfair Display',serif;font-weight:700;font-size:1.05rem;color:var(--navy-deep);line-height:1.25; }
        .lib-card-meta { font-size:.78rem;color:var(--text-soft);margin-top:.2rem; }
        .lib-card-bottom { display:flex;align-items:center;justify-content:space-between;padding:.6rem .9rem .8rem;border-top:1px dashed var(--line); }
        .lib-card-id-label { font-family:'JetBrains Mono',monospace;font-size:.62rem;letter-spacing:.08em;color:var(--text-soft);font-weight:700; }
        .lib-card-qr-wrap { background:#fff;padding:4px;border-radius:6px;box-shadow:var(--shadow-sm);line-height:0; }
        .book-qr-wrap { display:flex;justify-content:center;margin:.4rem 0 .6rem; }
        .book-qr-box { background:#fff;padding:8px;border:2px solid var(--sky);border-radius:10px;box-shadow:var(--shadow-sm);line-height:0; }
        .certificate {
          width:360px;max-width:100%;aspect-ratio:4/3;background:#FDF8ED;
          background-image:
            linear-gradient(45deg,rgba(201,162,39,.06) 25%,transparent 25%),
            linear-gradient(-45deg,rgba(201,162,39,.06) 25%,transparent 25%);
          background-size:22px 22px;border:6px double var(--sky);border-radius:10px;
          padding:1.1rem 1.1rem .9rem;display:flex;flex-direction:column;align-items:center;text-align:center;
          box-shadow:var(--shadow-md);
        }
        .cert-badge { font-size:1.9rem;margin-bottom:.1rem; }
        .cert-title { font-family:'Playfair Display',serif;font-weight:800;font-size:1.02rem;color:var(--navy-deep);letter-spacing:.03em;text-transform:uppercase; }
        .cert-sub { font-size:.64rem;color:var(--maroon);margin-top:.1rem;margin-bottom:.55rem; }
        .cert-presented { font-size:.7rem;color:var(--text-soft); }
        .cert-name { font-family:'Playfair Display',serif;font-weight:700;font-size:1.25rem;color:var(--navy);margin:.3rem 0;border-bottom:2px solid var(--gold-soft);padding-bottom:.2rem; }
        .cert-desc { font-size:.72rem;color:var(--text);line-height:1.45;max-width:92%;margin-top:.25rem; }
        .cert-month { font-weight:700;color:var(--maroon); }
        .cert-footer { display:flex;justify-content:space-between;width:100%;margin-top:auto;padding-top:.7rem; }
        .cert-foot-item { font-size:.62rem;color:var(--text-soft);text-align:center; }
        .cert-foot-line { border-top:1px solid var(--text-soft);width:80px;margin:0 auto .2rem; }

        /* ---- Settings ---- */
        .settings-sections { display:flex;flex-direction:column;gap:1rem; }
        .settings-section { background:#FAF6EC;border:1px solid var(--line);border-radius:10px;padding:.95rem 1.05rem; }
        .settings-section h3 { font-family:'Playfair Display',serif;font-size:.95rem;color:var(--navy);margin:0 0 .7rem;display:flex;align-items:center;gap:.45rem; }
        .settings-section .field:last-child { margin-bottom:0; }
        .settings-section .form-grid:last-child { margin-bottom:0; }
        .settings-footer {
          position:sticky;bottom:-1.4rem;background:#fff;margin:1rem -1.1rem -1.4rem;
          padding:.85rem 1.1rem;border-top:1px solid var(--line);display:flex;flex-direction:column;gap:.35rem;
        }

        @media (min-width:640px) and (max-width:1023px) { .app { max-width:640px; } }

        @media (min-width:1024px) {
          .app { max-width:none;padding-bottom:2rem;padding-left:240px; }
          .sidebar {
            display:flex;position:fixed;inset:0 auto 0 0;width:240px;
            background:linear-gradient(180deg,#0F3328 0%,#1B4D3E 100%);color:#fff;
            flex-direction:column;padding:1rem 0 .8rem;z-index:30;
            box-shadow:2px 0 12px rgba(0,0,0,.12);overflow-y:auto;
          }
          .sidebar-brand { padding:.4rem 1.2rem 1rem;border-bottom:1px solid rgba(255,255,255,.12);margin-bottom:.8rem; }
          .sidebar-brand-logo { font-family:'Playfair Display',serif;font-weight:800;font-size:1.3rem;line-height:1.15;color:#fff; }
          .sidebar-brand-sub { font-size:.68rem;color:var(--gold-soft);margin-top:.25rem;line-height:1.3; }
          .sidebar-actions { display:flex;flex-direction:column;gap:.4rem;padding:0 .7rem .9rem;margin-bottom:.6rem;border-bottom:1px solid rgba(255,255,255,.12); }
          .sidebar-action-btn {
            display:flex;align-items:center;gap:.6rem;background:var(--sky);color:var(--navy-deep);
            border:none;border-radius:8px;padding:.62rem .85rem;font-family:'Inter',sans-serif;
            font-weight:700;font-size:.85rem;cursor:pointer;text-align:left;
            transition:background .15s ease,transform .1s ease;
          }
          .sidebar-action-btn:hover { background:var(--gold-soft); }
          .sidebar-action-btn:active { transform:scale(.98); }
          .sidebar-action-btn svg { flex:0 0 auto;color:var(--navy-deep); }
          .sidebar-nav { display:flex;flex-direction:column;gap:.12rem;padding:0 .7rem;flex:1; }
          .sidebar-nav button {
            display:flex;align-items:center;gap:.7rem;background:transparent;color:rgba(255,255,255,.82);
            border:none;padding:.6rem .8rem;border-radius:8px;font-family:'Inter',sans-serif;
            font-size:.86rem;font-weight:500;cursor:pointer;text-align:left;position:relative;
            transition:background .15s ease,color .15s ease;
          }
          .sidebar-nav button:hover { background:rgba(255,255,255,.1);color:#fff; }
          .sidebar-nav button svg { flex:0 0 auto; }
          .sidebar-badge {
            position:absolute;right:.8rem;top:50%;transform:translateY(-50%);
            background:var(--danger);color:#fff;font-size:.68rem;font-weight:700;
            padding:.12rem .5rem;border-radius:999px;font-family:'JetBrains Mono',monospace;
          }
          .sidebar-footer { padding:.8rem .7rem 0;border-top:1px solid rgba(255,255,255,.12);display:flex;flex-direction:column;gap:.12rem; }
          .sidebar-footer button {
            display:flex;align-items:center;gap:.7rem;background:transparent;color:rgba(255,255,255,.65);
            border:none;padding:.55rem .8rem;border-radius:8px;font-family:'Inter',sans-serif;
            font-size:.82rem;cursor:pointer;text-align:left;
            transition:background .15s ease,color .15s ease;
          }
          .sidebar-footer button:hover { background:rgba(255,255,255,.1);color:#fff; }
          .header { padding:1.5rem 2rem .8rem; }
          .header .brand { display:none; }
          .header .icon-btn { display:none; }
          .desktop-title { display:block; }
          .search-wrap { margin:0 2rem .8rem; }
          .search-wrap input { font-size:.95rem;padding-top:.85rem;padding-bottom:.85rem; }
          .class-row { margin:0 2rem 1rem;flex-wrap:wrap;overflow-x:visible; }
          .book-hint { margin:0 2rem .8rem; }
          .student-list { padding:0 2rem 2rem;display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:.7rem; }
          .bottom-bar { display:none; }
          .modal-backdrop { align-items:center;justify-content:center;padding:1rem; }
          .modal-panel { max-width:900px;max-height:90vh;border-radius:14px;padding:1.4rem 1.8rem 1.8rem;animation:modalFadeIn .18s ease; }
          .modal-panel.modal-wide { max-width:1200px; }
          .modal-body { font-size:.95rem; }
          .modal-panel .row-card { padding:.75rem .9rem; }
          .modal-panel .row-card .title { font-size:.94rem; }
          .modal-panel .row-card .meta { font-size:.78rem; }
          .modal-panel th,.modal-panel td { padding:.65rem .4rem;font-size:.86rem; }
          .settings-footer { bottom:-1.8rem;margin:1.2rem -1.8rem -1.8rem;padding:1rem 1.8rem; }
          .settings-sections { display:grid;grid-template-columns:1fr 1fr;gap:1rem; }
          .settings-section:first-child,.settings-section:nth-child(5) { grid-column:1 / -1; }
          .empty { padding:3rem 1rem; }
        }
        @media (min-width:1440px) { .student-list { grid-template-columns:repeat(auto-fill,minmax(360px,1fr)); } }

        @media print {
          body * { visibility:hidden; }
          .print-area,.print-area * { visibility:visible; }
          html,body,.app,.modal-backdrop,.modal-panel {
            position:static !important;overflow:visible !important;max-height:none !important;
            height:auto !important;width:100% !important;background:#fff !important;
            box-shadow:none !important;padding:0 !important;margin:0 !important;
            border-radius:0 !important;inset:auto !important;padding-left:0 !important;
          }
          .print-area { position:static !important;width:100% !important;grid-template-columns:repeat(4,1fr);page-break-inside:auto; }
          .print-area.books-print { grid-template-columns:repeat(3,1fr); }
          .id-card { break-inside:avoid;page-break-inside:avoid; }
          .no-print,.modal-head,.header,.bottom-bar,.class-row,.search-wrap,.book-hint,.sidebar,.top-fixed,.desktop-title { display:none !important; }
        }

        /* ---- Dark mode ---- */
        .app.dark {
          --page-bg:#15171a;--text:#e8e3d8;--text-soft:#a89b7f;--row-bg:#232528;
          --line:#34373c;--search-bg:#1f2124;
          --shadow-sm:0 1px 3px rgba(0,0,0,0.35);
          --shadow-md:0 4px 12px rgba(0,0,0,0.45);
        }
        .app.dark .top-fixed {
          background-color:#15171a;
          background-image:
            linear-gradient(45deg,rgba(201,162,39,0.05) 25%,transparent 25%),
            linear-gradient(-45deg,rgba(201,162,39,0.05) 25%,transparent 25%),
            linear-gradient(45deg,transparent 75%,rgba(201,162,39,0.05) 75%),
            linear-gradient(-45deg,transparent 75%,rgba(201,162,39,0.05) 75%);
        }
        .app.dark .brand h1,.app.dark .desktop-title h1 { color:#e8e3d8; }
        .app.dark .search-wrap input { background:#1f2124;color:var(--text); }
        .app.dark .class-row { background:#1f2124; }
        .app.dark .student-row { background:#232528; }
        .app.dark .modal-panel { background:#1a1c1f;color:var(--text); }
        .app.dark .modal-head h2 { color:#e8e3d8; }
        .app.dark .menu-row { background:#232528;color:var(--text); }
        .app.dark .menu-row:hover { background:#2a2d31; }
        .app.dark .search-results { background:#1a1c1f;border-color:#34373c; }
        .app.dark .search-result-item:hover { background:#232528; }
        .app.dark .settings-section { background:#232528; }
        .app.dark .settings-section h3 { color:#e8e3d8; }
        .app.dark .settings-footer { background:#1a1c1f; }
        .app.dark input[type="text"],.app.dark input[type="number"],.app.dark input[type="search"],
        .app.dark input[type="month"],.app.dark input[type="email"],.app.dark input[type="password"],
        .app.dark input[type="tel"],.app.dark select,.app.dark textarea {
          background:#1f2124;color:var(--text);border-color:#34373c;
        }
        .app.dark .row-card { background:#232528; }
        .app.dark .row-card.overdue { background:#3a1f1f; }
        .app.dark .stat-card { background:#232528; }
        .app.dark .stat-card .num { color:#c9a227; }
        .app.dark .pick-item { background:#1f2124;border-color:#34373c; }
        .app.dark .pick-item.selected { background:#2a3a2e; }
        .app.dark .current-pick { background:#2a3a2e; }
        .app.dark .stamp-card { background:#1a1c1f; }
        .app.dark .bottom-bar { background:#1a1c1f; }
        .app.dark .book-hint { background:#1e2a35;border-color:#2a3a45;color:#a8c5d8; }
        .app.dark .empty { color:var(--text-soft); }
        .app.dark th { color:var(--text-soft); }
        .app.dark td { border-bottom-color:#34373c; }
        .app.dark .lock-screen { background:#15171a; }
        .app.dark .lock-screen h1 { color:#e8e3d8; }
        .app.dark .search-section-title { color:#8a7f68; }
        .app.dark .sidebar { background:linear-gradient(180deg,#0a1512 0%,#0f1f19 100%); }
      `}</style>

      {!authReady ? (
        <div className="empty">Loading...</div>
      ) : !user ? (
        <div className="lock-screen">
          <div className="lock-icon"><Lock size={26} /></div>
          <h1>{appSettings.libraryName || "NMMI ISLAMIC LIBRARY"}</h1>
          <div className="sub">{appSettings.librarySubtitle || "Nandiyil Muhammed Musliyar Memorial Islamic Library"}</div>
          <form className="lock-form" onSubmit={handleSignIn}>
            <p style={{ fontSize: ".86rem", color: "var(--text-soft)", marginBottom: ".9rem", textAlign: "center" }}>
              Sign in with the staff account created for you in Firebase.
            </p>
            {pwError && <div className="lock-error">{pwError}</div>}
            <div className="field"><label>Email</label><input type="email" value={signInEmail} onChange={(e) => setSignInEmail(e.target.value)} autoFocus required /></div>
            <div className="field"><label>Password</label><input type="password" value={signInPassword} onChange={(e) => setSignInPassword(e.target.value)} required /></div>
            <button type="submit" className="btn full" disabled={signingIn}><Lock size={15} /> {signingIn ? "Signing in..." : "Sign In"}</button>
            <div className="lock-hint">No account yet? Add one in the Firebase Console under Authentication → Users.</div>
          </form>
        </div>
      ) : (
        <>
          <aside className="sidebar">
            <div className="sidebar-brand">
              <div className="sidebar-brand-logo">{(appSettings.libraryName || "NMMI").split(" ")[0]}</div>
              <div className="sidebar-brand-sub">
                {appSettings.libraryName || "Islamic Library"}<br />
                {appSettings.librarySubtitle || "Nandiyil Muhammed Musliyar Memorial"}
              </div>
            </div>
            <div className="sidebar-actions">
              <button className="sidebar-action-btn" onClick={openIssue}><BookMarked size={18} /><span>Issue Book</span></button>
              <button className="sidebar-action-btn" onClick={openReturn}><RotateCcw size={18} /><span>Return Book</span></button>
              <button className="sidebar-action-btn" onClick={openAddStudent}><UserPlus size={18} /><span>Add Student</span></button>
            </div>
            <nav className="sidebar-nav">
              <button onClick={() => setSheet("dashboard")}><LayoutDashboard size={18} /> Dashboard</button>
              <button onClick={() => setSheet("catalog")}><Library size={18} /> Book Catalog</button>
              <button onClick={() => setSheet("bookCategories")}><Bookmark size={18} /> Categories</button>
              <button onClick={() => setSheet("classes")}><Layers size={18} /> Classes</button>
              <button onClick={openPromotion}><GraduationCap size={18} /> Promotion</button>
              <button onClick={() => setSheet("overdue")}>
                <AlertTriangle size={18} /> Overdue
                {overdueTx.length > 0 && <span className="sidebar-badge">{overdueTx.length}</span>}
              </button>
              <button onClick={() => { setCertMonth(todayISO().slice(0, 7)); setCertStudentId(""); setSheet("certificate"); }}>
                <Award size={18} /> Certificate
              </button>
              <button onClick={() => setSheet("printCards")}><Printer size={18} /> Print QR Labels</button>
              <button onClick={() => { setSettingsDraft(appSettings); setSettingsSavedMsg(""); setSheet("settings"); }}>
                <Settings size={18} /> Settings
              </button>
            </nav>
            <div className="sidebar-footer">
              <button onClick={() => { setChangeNewPw(""); setChangeNewPw2(""); setChangeError(""); setChangeSuccess(false); setSheet("changePassword"); }}>
                <Lock size={16} /> Change Password
              </button>
              <button onClick={handleSignOut}><LogOut size={16} /> Sign Out</button>
            </div>
          </aside>

          <div className="top-fixed">
            <div className="header">
              <div className="brand">
                <h1>{appSettings.libraryName || "NMMI ISLAMIC LIBRARY"}</h1>
                <div className="sub">{appSettings.librarySubtitle || "Nandiyil Muhammed Musliyar Memorial Islamic Library"}</div>
              </div>
              <div className="desktop-title">
                <h1>Students</h1>
                <div className="sub">
                  {filteredStudents.length} student{filteredStudents.length === 1 ? "" : "s"}
                  {selectedClass !== "ALL" ? ` · ${selectedClass || "Unassigned"}` : ""}
                </div>
              </div>
              <button className="icon-btn" onClick={() => setSheet("menu")} aria-label="Menu"><MoreVertical size={22} /></button>
            </div>

            <div className="search-wrap" ref={searchWrapRef}>
              <Search size={16} className="icon" />
              <input
                type="search"
                className="with-scan"
                placeholder="Search students, books, or codes..."
                value={homeQuery}
                onChange={(e) => {
                  setHomeQuery(e.target.value);
                  setShowSearchResults(e.target.value.trim().length > 0);
                }}
                onFocus={() => { if (homeQuery.trim().length > 0) setShowSearchResults(true); }}
              />
              <button type="button" className="scan-btn" onClick={() => openScanner("home")} aria-label="Scan QR code"><Camera size={15} /></button>

              {showSearchResults && homeQuery.trim().length > 0 && (
                <div className="search-results">
                  {searchStudentMatches.length > 0 && (
                    <div className="search-section">
                      <div className="search-section-title"><UserPlus size={12} /> Students ({searchStudentMatches.length})</div>
                      {searchStudentMatches.map((s) => (
                        <button key={s.id} className="search-result-item" onClick={() => { setShowSearchResults(false); setHomeQuery(""); openStudentDetail(s.id); }}>
                          <Avatar name={s.name} photoUrl={s.photoUrl} size={32} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="sr-title">{s.name}</div>
                            <div className="sr-meta">{s.className || "Unassigned"}{s.roll ? ` · Roll ${s.roll}` : ""}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  {searchBookMatches.length > 0 && (
                    <div className="search-section">
                      <div className="search-section-title"><Library size={12} /> Books ({searchBookMatches.length})</div>
                      {searchBookMatches.map((b) => (
                        <button key={b.id} className="search-result-item" onClick={() => { setShowSearchResults(false); setHomeQuery(""); openBookDetail(b.id); }}>
                          <div className="sr-icon"><Library size={16} /></div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="sr-title">{b.title}</div>
                            <div className="sr-meta">{b.author ? `${b.author} · ` : ""}{b.code} · {b.availableCopies}/{b.totalCopies}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  {searchStudentMatches.length === 0 && searchBookMatches.length === 0 && (
                    <div className="search-no-results">No matches for "{homeQuery}"</div>
                  )}
                </div>
              )}
            </div>

            <div className="class-row">
              <button className={`class-chip ${selectedClass === "ALL" ? "active" : ""}`} onClick={() => setSelectedClass("ALL")}>ALL</button>
              {students.some((s) => !s.className) && (
                <button className={`class-chip ${selectedClass === "" ? "active" : ""}`} onClick={() => setSelectedClass("")}>Unassigned</button>
              )}
              {classes.map((c) => (
                <button key={c} className={`class-chip ${selectedClass === c ? "active" : ""}`} onClick={() => setSelectedClass(c)}>{c}</button>
              ))}
            </div>
          </div>

          {!showSearchResults && bookMatchForSearch && (
            <div className="book-hint">
              <b>{bookMatchForSearch.title}</b> ({bookMatchForSearch.code}) — {bookMatchForSearch.availableCopies}/
              {bookMatchForSearch.totalCopies} available
              {(() => {
                const holders = activeTx.filter((t) => t.bookId === bookMatchForSearch.id)
                  .map((t) => studentById(t.studentId)).filter(Boolean);
                if (holders.length === 0) return null;
                return <> · with: {holders.map((h) => h.name).join(", ")}</>;
              })()}
            </div>
          )}

          {loading ? (
            <div className="empty">Loading...</div>
          ) : filteredStudents.length === 0 ? (
            <div className="empty">
              {students.length === 0 ? "No students added yet. Use the Add Student button below to get started." : "No matching students."}
            </div>
          ) : (
            <div className="student-list">
              {filteredStudents.map((s) => {
                const holding = studentActiveTx(s.id).length;
                const overdue = studentHasOverdue(s.id);
                const isSelected = selectedStudentId === s.id;
                return (
                  <div key={s.id} className={`student-row ${isSelected ? "selected" : ""}`}>
                    <button className="student-row-main" onClick={() => setSelectedStudentId(isSelected ? null : s.id)}>
                      <Avatar name={s.name} photoUrl={s.photoUrl}>
                        {overdue && <span className="dot-badge" />}
                        {isSelected && <span className="check-badge"><Check size={10} color="#fff" /></span>}
                      </Avatar>
                      <div>
                        <div className="student-name">{s.name}</div>
                        <div className="student-meta">
                          {s.className || "Unassigned"}{s.roll ? ` · Roll ${s.roll}` : ""}
                          {holding > 0 ? ` · holding ${holding}` : ""}
                        </div>
                      </div>
                    </button>
                    <button className="row-view-btn" onClick={() => openStudentDetail(s.id)} aria-label={`View ${s.name}'s book history`}>
                      <ChevronRight size={20} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="bottom-bar">
            <button className="bottom-item" onClick={openIssue}><span className="bottom-dot"><BookMarked size={16} /></span><span className="label">ISSUE BOOK</span></button>
            <button className="bottom-item" onClick={openReturn}><span className="bottom-dot"><RotateCcw size={16} /></span><span className="label">RETURN BOOK</span></button>
            <button className="bottom-item" onClick={openAddStudent}><span className="bottom-dot"><UserPlus size={16} /></span><span className="label">ADD STUDENT</span></button>
          </div>

          {/* ==================== MODALS ==================== */}
          {sheet === "menu" && (
            <Modal title="More" onClose={() => setSheet(null)}>
              <div className="menu-list">
                <button className="menu-row" onClick={() => setSheet("dashboard")}><LayoutDashboard size={18} /> Dashboard</button>
                <button className="menu-row" onClick={() => setSheet("catalog")}><Library size={18} /> Book Catalog</button>
                <button className="menu-row" onClick={() => setSheet("bookCategories")}><Bookmark size={18} /> Book Categories</button>
                <button className="menu-row" onClick={() => setSheet("classes")}><Layers size={18} /> Manage Classes</button>
                <button className="menu-row" onClick={openPromotion}><GraduationCap size={18} /> Class Promotion</button>
                <button className="menu-row" onClick={() => setSheet("overdue")}>
                  <AlertTriangle size={18} /> Overdue Books
                  {overdueTx.length > 0 && <span style={{ marginLeft: "auto", background: "var(--danger)", color: "#fff", padding: ".15rem .5rem", borderRadius: "999px", fontSize: ".7rem" }}>{overdueTx.length}</span>}
                </button>
                <button className="menu-row" onClick={() => { setCertMonth(todayISO().slice(0, 7)); setCertStudentId(""); setSheet("certificate"); }}>
                  <Award size={18} /> Monthly Certificate
                </button>
                <button className="menu-row" onClick={() => setSheet("printCards")}><Printer size={18} /> Print QR Labels</button>
                <button className="menu-row" onClick={() => { setSettingsDraft(appSettings); setSettingsSavedMsg(""); setSheet("settings"); }}>
                  <Settings size={18} /> Settings
                </button>
                <button className="menu-row" onClick={() => { setChangeNewPw(""); setChangeNewPw2(""); setChangeError(""); setChangeSuccess(false); setSheet("changePassword"); }}>
                  <Lock size={18} /> Change Password
                </button>
                <button className="menu-row" onClick={handleSignOut}><LogOut size={18} /> Sign Out</button>
              </div>
            </Modal>
          )}

          {sheet === "changePassword" && (
            <Modal title="Change Password" onClose={() => setSheet(null)}>
              {changeSuccess ? (
                <div className="empty"><Check size={18} style={{ marginBottom: ".3rem" }} /><br />Password updated.</div>
              ) : (
                <form onSubmit={handleChangePassword}>
                  {changeError && <div className="lock-error">{changeError}</div>}
                  <div className="field"><label>New password</label><input type="password" value={changeNewPw} onChange={(e) => setChangeNewPw(e.target.value)} required /></div>
                  <div className="field"><label>Confirm new password</label><input type="password" value={changeNewPw2} onChange={(e) => setChangeNewPw2(e.target.value)} required /></div>
                  <button type="submit" className="btn full"><Lock size={15} /> Update Password</button>
                </form>
              )}
            </Modal>
          )}

          {sheet === "settings" && (
            <Modal title="Settings" onClose={() => setSheet(null)} wide>
              <div className="settings-sections">
                <div className="settings-section">
                  <h3><Library size={16} /> Library Info</h3>
                  <div className="field">
                    <label>Library name</label>
                    <input type="text" value={settingsDraft.libraryName} onChange={(e) => setSettingsDraft({ ...settingsDraft, libraryName: e.target.value })} />
                  </div>
                  <div className="field">
                    <label>Subtitle</label>
                    <input type="text" value={settingsDraft.librarySubtitle} onChange={(e) => setSettingsDraft({ ...settingsDraft, librarySubtitle: e.target.value })} />
                  </div>
                  <div className="form-grid">
                    <div>
                      <label>Librarian name</label>
                      <input type="text" value={settingsDraft.librarianName} onChange={(e) => setSettingsDraft({ ...settingsDraft, librarianName: e.target.value })} placeholder="For certificates" />
                    </div>
                    <div>
                      <label>Phone</label>
                      <input type="tel" value={settingsDraft.phone} onChange={(e) => setSettingsDraft({ ...settingsDraft, phone: e.target.value })} />
                    </div>
                  </div>
                </div>

                <div className="settings-section">
                  <h3><Clock size={16} /> Loan Rules</h3>
                  <div className="form-grid">
                    <div>
                      <label>Default loan days</label>
                      <input type="number" min="1" value={settingsDraft.defaultLoanDays} onChange={(e) => setSettingsDraft({ ...settingsDraft, defaultLoanDays: parseInt(e.target.value) || 14 })} />
                    </div>
                    <div>
                      <label>Max books per student (0 = unlimited)</label>
                      <input type="number" min="0" value={settingsDraft.maxBooksPerStudent} onChange={(e) => setSettingsDraft({ ...settingsDraft, maxBooksPerStudent: parseInt(e.target.value) || 0 })} />
                    </div>
                  </div>
                  <div className="form-grid">
                    <div>
                      <label>Fine per day (₹)</label>
                      <input type="number" min="0" value={settingsDraft.finePerDay} onChange={(e) => setSettingsDraft({ ...settingsDraft, finePerDay: parseInt(e.target.value) || 0 })} />
                    </div>
                    <div>
                      <label>Grace days before fine</label>
                      <input type="number" min="0" value={settingsDraft.graceDays} onChange={(e) => setSettingsDraft({ ...settingsDraft, graceDays: parseInt(e.target.value) || 0 })} />
                    </div>
                  </div>
                </div>

                <div className="settings-section">
                  <h3><Palette size={16} /> Appearance</h3>
                  <label style={{ display: "flex", alignItems: "center", gap: ".6rem", cursor: "pointer", fontSize: ".92rem", color: "var(--text)", marginBottom: 0 }}>
                    <input type="checkbox" checked={settingsDraft.darkMode} onChange={(e) => setSettingsDraft({ ...settingsDraft, darkMode: e.target.checked })} style={{ width: "auto", margin: 0 }} />
                    Dark mode
                  </label>
                </div>

                <div className="settings-section">
                  <h3><FileDown size={16} /> Data & Backup</h3>
                  <p style={{ fontSize: ".8rem", color: "var(--text-soft)", margin: "0 0 .7rem" }}>
                    Download a snapshot of your library data as CSV. Safe to open in Excel or Google Sheets.
                  </p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: ".5rem" }}>
                    <button type="button" className="btn secondary" onClick={exportBooksCSV}><FileDown size={14} /> Books</button>
                    <button type="button" className="btn secondary" onClick={exportStudentsCSV}><FileDown size={14} /> Students</button>
                    <button type="button" className="btn secondary" onClick={exportTransactionsCSV}><FileDown size={14} /> Transactions</button>
                  </div>
                </div>

                <div className="settings-section">
                  <h3><Lock size={16} /> Account</h3>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: ".5rem" }}>
                    <button type="button" className="btn secondary" onClick={() => { setChangeNewPw(""); setChangeNewPw2(""); setChangeError(""); setChangeSuccess(false); setSheet("changePassword"); }}>
                      <Lock size={14} /> Change Password
                    </button>
                    <button type="button" className="btn secondary" onClick={handleSignOut}><LogOut size={14} /> Sign Out</button>
                  </div>
                </div>
              </div>

              <div className="settings-footer">
                {settingsSavedMsg && (
                  <div style={{ color: settingsSavedMsg.startsWith("✅") ? "#1F8A5E" : "var(--danger)", fontSize: ".84rem", fontWeight: 700 }}>{settingsSavedMsg}</div>
                )}
                <button className="btn full" onClick={saveSettings} disabled={settingsSaving}>
                  <Save size={16} /> {settingsSaving ? "Saving..." : "Save Settings"}
                </button>
              </div>
            </Modal>
          )}

          {sheet === "printCards" && (
            <Modal title="Print QR Labels" onClose={() => setSheet(null)} wide>
              <div className="no-print">
                <div style={{ display: "flex", gap: ".5rem", marginBottom: ".7rem" }}>
                  <button className={`btn ${printMode === "students" ? "" : "secondary"}`} style={{ flex: 1, justifyContent: "center" }} onClick={() => setPrintMode("students")}>Students</button>
                  <button className={`btn ${printMode === "books" ? "" : "secondary"}`} style={{ flex: 1, justifyContent: "center" }} onClick={() => setPrintMode("books")}>Books</button>
                </div>
                {printMode === "students" && (
                  <select value={printClass} onChange={(e) => setPrintClass(e.target.value)} style={{ marginBottom: ".7rem" }}>
                    <option value="ALL">All classes</option>
                    {classes.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                )}
                <p style={{ fontSize: ".78rem", color: "var(--text-soft)", marginBottom: ".8rem" }}>
                  Each QR code encodes the {printMode === "students" ? "student's roll number" : "book's code (prefixed with BOOK:)"} — scanning it in the app finds that {printMode === "students" ? "student" : "book"} automatically.
                  Tap Print, then choose "Save as PDF" to print or share.
                </p>
                <button className="btn full" onClick={() => window.print()}><Printer size={16} /> Print / Save as PDF</button>
              </div>
              <div className={`print-area ${printMode === "books" ? "books-print" : ""}`} style={{ marginTop: ".8rem" }}>
                {printMode === "students"
                  ? students.filter((s) => printClass === "ALL" || s.className === printClass).map((s) => (
                      <div className="id-card" key={s.id}>
                        <div className="id-card-name">{s.name}</div>
                        <div className="id-card-meta">{s.className || "Unassigned"}{s.roll ? ` · Roll ${s.roll}` : ""}</div>
                        <QRCodeCanvas value={s.roll} />
                      </div>
                    ))
                  : books.map((b) => (
    <div className="id-card book-label-card" key={b.id}>
      <div className="book-label-code">{b.code}</div>
      <QRCodeCanvas value={bookQrValue(b.code)} size={100} />
    </div>
  ))}

          {sheet === "issue" && (
            <Modal title="Issue Book" onClose={() => setSheet(null)}>
              {selectedStudent ? (
                <div className="current-pick">
                  <span>Student: <b>{selectedStudent.name}</b> ({selectedStudent.className})</span>
                  <button onClick={() => setSelectedStudentId(null)}>Change</button>
                </div>
              ) : (
                <div className="field">
                  <label>Find student</label>
                  <div className="scan-row">
                    <input type="search" value={issueStudentQuery} onChange={(e) => setIssueStudentQuery(e.target.value)} placeholder="Name or roll number..." />
                    <button type="button" className="scan-btn-inline" onClick={() => openScanner("issueStudent")} aria-label="Scan student QR"><Camera size={16} /></button>
                  </div>
                  <div className="pick-list">
                    {issueStudentMatches.length === 0 && <div className="empty">No students found</div>}
                    {issueStudentMatches.map((s) => (
                      <button key={s.id} className="pick-item" onClick={() => setSelectedStudentId(s.id)}>
                        <span className="badge">{s.roll}</span>
                        <span><div className="t-title">{s.name}</div><div className="t-meta">{s.className}</div></span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="field">
                <label>Find book</label>
                <div style={{ display: "flex", gap: ".5rem" }}>
                  <input type="search" style={{ flex: 1 }} value={bookQuery} onChange={(e) => setBookQuery(e.target.value)} placeholder="Title, author or code..." />
                  <button type="button" className="scan-btn-inline" onClick={() => openScanner("issueBook")} aria-label="Scan book QR"><Camera size={16} /></button>
                </div>
                <div className="pick-list">
                  {issueBookMatches.length === 0 && <div className="empty">No books found</div>}
                  {issueBookMatches.map((b) => (
                    <button key={b.id} className={`pick-item ${selectedBook?.id === b.id ? "selected" : ""}`} onClick={() => setSelectedBook(b)} disabled={b.availableCopies < 1}>
                      <span className="badge">{b.availableCopies}/{b.totalCopies}</span>
                      <span><div className="t-title">{b.title}</div><div className="t-meta">{b.author} · {b.code}</div></span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="form-grid" style={{ gridTemplateColumns: "120px 1fr", alignItems: "end" }}>
                <div><label>Days</label><input type="number" min="1" value={days} onChange={(e) => setDays(e.target.value)} /></div>
                <div>
                  <button className="btn full" disabled={!selectedStudentId || !selectedBook || selectedBook.availableCopies < 1} onClick={issueBook}>
                    <BookMarked size={16} /> Issue Book
                  </button>
                </div>
              </div>
              {lastIssued && (
                <div className="stamp-card">
                  <div className="stamp-mark"><div className="l1">Issued</div><div className="l2">{formatDate(lastIssued.dueDate)}</div></div>
                  <div className="stamp-info">
                    <b>{lastIssued.bookTitle}</b> issued to {lastIssued.studentName}.<br />Due on <b>{formatDate(lastIssued.dueDate)}</b>
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
                    <span>Student: <b>{selectedStudent.name}</b> ({selectedStudent.className})</span>
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
                            <div><div className="title">{book?.title}</div><div className="meta">{book?.code}</div></div>
                            <div style={{ display: "flex", alignItems: "center", gap: ".6rem" }}>
                              <div className="due">{overdue ? "Overdue: " : "Due: "}{formatDate(t.dueDate)}</div>
                              {justReturnedId === t.id ? (
                                <span className="returned-flash"><Check size={14} /> Returned</span>
                              ) : (
                                <button className="btn secondary" onClick={() => returnBook(t.id)}><RotateCcw size={13} /> Return</button>
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
                  <div className="field" style={{ display: "flex", gap: ".5rem" }}>
                    <input type="search" style={{ flex: 1 }} value={returnQuery} onChange={(e) => setReturnQuery(e.target.value)} placeholder="Search book or student name..." />
                    <button type="button" className="scan-btn-inline" onClick={() => openScanner("return")} aria-label="Scan QR"><Camera size={16} /></button>
                  </div>
                  {returnSearchMatches.length === 0 ? (
                    <div className="empty">No books currently issued.</div>
                  ) : (
                    <div className="row-list">
                      {returnSearchMatches.map((r) => {
                        const overdue = r.tx.dueDate < todayISO();
                        return (
                          <div key={r.tx.id} className={`row-card ${overdue ? "overdue" : ""}`}>
                            <div><div className="title">{r.book.title}</div><div className="meta">{r.student.name} ({r.student.className})</div></div>
                            <div style={{ display: "flex", alignItems: "center", gap: ".6rem" }}>
                              <div className="due">{overdue ? "Overdue: " : "Due: "}{formatDate(r.tx.dueDate)}</div>
                              {justReturnedId === r.tx.id ? (
                                <span className="returned-flash"><Check size={14} /> Returned</span>
                              ) : (
                                <button className="btn secondary" onClick={() => returnBook(r.tx.id)}><RotateCcw size={13} /> Return</button>
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
            <Modal title="Students" onClose={() => setSheet(null)} wide>
              <form onSubmit={addStudent}>
                <div className="field"><label>Name</label><input type="text" value={studentForm.name} onChange={(e) => setStudentForm({ ...studentForm, name: e.target.value })} required /></div>
                <div className="form-grid">
                  <div>
                    <label>Class</label>
                    <select value={studentForm.className} onChange={(e) => setStudentForm({ ...studentForm, className: e.target.value })}>
                      <option value="">Unassigned</option>
                      {classes.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div><label>Roll number</label><input type="text" value={studentForm.roll} onChange={(e) => setStudentForm({ ...studentForm, roll: e.target.value })} required /></div>
                </div>
                <div className="field"><label>Phone (optional)</label><input type="tel" value={studentForm.phone} onChange={(e) => setStudentForm({ ...studentForm, phone: e.target.value })} placeholder="10-digit mobile number" /></div>
                <button type="submit" className="btn full"><Plus size={16} /> Add Student</button>
              </form>
              <div style={{ borderTop: "1px solid #EEE", marginTop: "1.1rem", paddingTop: ".9rem" }}>
                <h2 style={{ fontFamily: "Playfair Display, serif", fontSize: ".98rem", color: "var(--navy)", marginBottom: ".5rem" }}>Add many at once</h2>
                <p style={{ fontSize: ".78rem", color: "var(--text-soft)", marginBottom: ".6rem" }}>
                  Paste one student per line. Either just a name, or "Name, Class, Roll, Phone" per line.
                </p>
                <form onSubmit={addStudentsBulk}>
                  <div className="form-grid">
                    <div>
                      <label>Default class</label>
                      <select value={bulkClass} onChange={(e) => setBulkClass(e.target.value)}>
                        <option value="">Unassigned</option>
                        {classes.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div><label>Starting roll no. (optional)</label><input type="text" value={bulkStartRoll} onChange={(e) => setBulkStartRoll(e.target.value)} placeholder="e.g. 1" /></div>
                  </div>
                  <div className="field">
                    <label>Students — one per line</label>
                    <textarea rows={5} value={bulkNames} onChange={(e) => setBulkNames(e.target.value)} placeholder={"Fathima, CLASS-1, 12\nAhmed Riyas, CLASS-2, 7\nAisha"} style={{ resize: "vertical" }} />
                  </div>
                  <button type="submit" className="btn full secondary"><Plus size={16} /> Add All Students</button>
                </form>
              </div>
              <div style={{ borderTop: "1px solid #EEE", marginTop: "1.1rem", paddingTop: ".9rem" }}>
                <h2 style={{ fontFamily: "Playfair Display, serif", fontSize: ".98rem", color: "var(--navy)", marginBottom: ".5rem" }}>All students</h2>
                <input type="search" value={studentListQuery} onChange={(e) => setStudentListQuery(e.target.value)} placeholder="Search name or roll..." style={{ marginBottom: ".6rem" }} />
                <div className="row-list" style={{ maxHeight: 280, overflowY: "auto" }}>
                  {studentListForManage.length === 0 && <div className="empty">No students yet.</div>}
                  {studentListForManage.map((s) =>
                    editingStudentId === s.id ? (
                      <form key={s.id} onSubmit={saveEditStudent} className="row-card" style={{ flexDirection: "column", alignItems: "stretch", gap: ".5rem" }}>
                        <input type="text" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} required />
                        <div className="form-grid" style={{ marginBottom: 0 }}>
                          <select value={editForm.className} onChange={(e) => setEditForm({ ...editForm, className: e.target.value })}>
                            <option value="">Unassigned</option>
                            {classes.map((c) => <option key={c} value={c}>{c}</option>)}
                          </select>
                          <input type="text" value={editForm.roll} onChange={(e) => setEditForm({ ...editForm, roll: e.target.value })} placeholder="Roll (optional)" />
                        </div>
                        <input type="tel" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} placeholder="Phone (optional)" />
                        <div style={{ display: "flex", gap: ".5rem" }}>
                          <button type="submit" className="btn" style={{ flex: 1, justifyContent: "center" }}><Check size={14} /> Save</button>
                          <button type="button" className="btn secondary" style={{ flex: 1, justifyContent: "center" }} onClick={cancelEditStudent}><X size={14} /> Cancel</button>
                        </div>
                      </form>
                    ) : (
                      <div key={s.id} className="row-card">
                        <div><div className="title">{s.name}</div><div className="meta">{s.className || "Unassigned"}{s.roll ? ` · Roll ${s.roll}` : ""}</div></div>
                        <div style={{ display: "flex", gap: ".4rem" }}>
                          <button className="btn secondary" onClick={() => startEditStudent(s)}><Pencil size={13} /> Edit</button>
                          <button className="btn secondary" onClick={() => deleteStudent(s)} aria-label="Remove student"><Trash2 size={13} /></button>
                        </div>
                      </div>
                    )
                  )}
                </div>
              </div>
            </Modal>
          )}

          {sheet === "bookCategories" && (
            <Modal title="Book Categories" onClose={() => setSheet(null)} wide>
              <form onSubmit={addCategory} style={{ display: "flex", gap: ".5rem", alignItems: "flex-end", marginBottom: "1rem" }}>
                <div style={{ flex: 1 }}><label>New category name</label><input type="text" value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} placeholder="e.g. Fiqh" /></div>
                <button type="submit" className="btn"><Plus size={16} /> Add</button>
              </form>
              <div className="row-list">
                {categories.map((c) => {
                  const count = books.filter((b) => b.category === c).length;
                  return editingCategoryOld === c ? (
                    <form key={c} onSubmit={saveEditCategory} className="row-card" style={{ flexDirection: "column", alignItems: "stretch", gap: ".5rem" }}>
                      <input type="text" value={editCategoryName} onChange={(e) => setEditCategoryName(e.target.value)} required />
                      <div style={{ display: "flex", gap: ".5rem" }}>
                        <button type="submit" className="btn" style={{ flex: 1, justifyContent: "center" }}><Check size={14} /> Save</button>
                        <button type="button" className="btn secondary" style={{ flex: 1, justifyContent: "center" }} onClick={cancelEditCategory}><X size={14} /> Cancel</button>
                      </div>
                    </form>
                  ) : (
                    <div key={c} className="row-card">
                      <div><div className="title">{c}</div><div className="meta">{count} book{count === 1 ? "" : "s"}</div></div>
                      <div style={{ display: "flex", gap: ".4rem" }}>
                        <button className="btn secondary" onClick={() => startEditCategory(c)} aria-label="Rename category"><Pencil size={13} /></button>
                        <button className="btn secondary" onClick={() => deleteCategory(c)} aria-label="Remove category"><Trash2 size={13} /></button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Modal>
          )}

          {sheet === "catalog" && (
            <Modal title="Book Catalog" onClose={() => setSheet(null)} wide>
              <div className="field"><input type="search" value={catalogQuery} onChange={(e) => setCatalogQuery(e.target.value)} placeholder="Search books..." /></div>
              <div style={{ maxHeight: 400, overflowY: "auto", marginBottom: "1rem" }}>
                {catalogGrouped.length === 0 ? (
                  <div className="empty">No books found.</div>
                ) : (
                  catalogGrouped.map(([cat, list]) => (
                    <div key={cat} style={{ marginBottom: ".9rem" }}>
                      <h3 style={{ fontFamily: "Playfair Display, serif", fontSize: ".88rem", color: "var(--navy)", margin: "0 0 .4rem", borderBottom: "1px solid #EEE", paddingBottom: ".25rem" }}>
                        {cat} <span style={{ color: "var(--text-soft)", fontWeight: 400, fontSize: ".75rem" }}>({list.length})</span>
                      </h3>
                      <div className="row-list">
                        {list.map((b) =>
                          editingBookId === b.id ? (
                            <form key={b.id} onSubmit={saveEditBook} className="row-card" style={{ flexDirection: "column", alignItems: "stretch", gap: ".5rem" }}>
                              <input type="text" value={editBookForm.title} onChange={(e) => setEditBookForm({ ...editBookForm, title: e.target.value })} placeholder="Title" required />
                              <input type="text" value={editBookForm.author} onChange={(e) => setEditBookForm({ ...editBookForm, author: e.target.value })} placeholder="Author" />
                              <div className="form-grid" style={{ marginBottom: 0 }}>
                                <select value={editBookForm.category} onChange={(e) => setEditBookForm({ ...editBookForm, category: e.target.value })}>
                                  <option value="">Uncategorized</option>
                                  {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                                </select>
                                <input type="number" min="1" value={editBookForm.copies} onChange={(e) => setEditBookForm({ ...editBookForm, copies: e.target.value })} />
                              </div>
                              <div className="meta" style={{ fontSize: ".72rem" }}>Code: {b.code} (fixed)</div>
                              <div style={{ display: "flex", gap: ".5rem" }}>
                                <button type="submit" className="btn" style={{ flex: 1, justifyContent: "center" }}><Check size={14} /> Save</button>
                                <button type="button" className="btn secondary" style={{ flex: 1, justifyContent: "center" }} onClick={cancelEditBook}><X size={14} /> Cancel</button>
                              </div>
                            </form>
                          ) : (
                            <div key={b.id} className="row-card">
                              <div><div className="title">{b.title}</div><div className="meta">{b.author} · {b.code} · {b.availableCopies}/{b.totalCopies}</div></div>
                              <div style={{ display: "flex", gap: ".4rem" }}>
                                <button className="btn secondary" onClick={() => openBookDetail(b.id)} aria-label="View book details"><QrCode size={13} /></button>
                                <button className="btn secondary" onClick={() => startEditBook(b)} aria-label="Edit book"><Pencil size={13} /></button>
                                <button className="btn secondary" onClick={() => deleteBook(b)} aria-label="Remove book"><Trash2 size={13} /></button>
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
                <div className="field"><label>Title</label><input type="text" value={bookForm.title} onChange={(e) => setBookForm({ ...bookForm, title: e.target.value })} required /></div>
                <div className="field"><label>Author</label><input type="text" value={bookForm.author} onChange={(e) => setBookForm({ ...bookForm, author: e.target.value })} /></div>
                <div className="field">
                  <label>Category</label>
                  <select value={bookForm.category} onChange={(e) => setBookForm({ ...bookForm, category: e.target.value })}>
                    <option value="">Uncategorized</option>
                    {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="form-grid">
                  <div><label>Code</label><input type="text" value={bookForm.code} onChange={(e) => setBookForm({ ...bookForm, code: e.target.value })} required /></div>
                  <div><label>Copies</label><input type="number" min="1" value={bookForm.copies} onChange={(e) => setBookForm({ ...bookForm, copies: e.target.value })} /></div>
                </div>
                <button type="submit" className="btn full"><Plus size={16} /> Add Book</button>
              </form>
              <div style={{ borderTop: "1px solid #EEE", marginTop: "1.1rem", paddingTop: ".9rem" }}>
                <h2 style={{ fontFamily: "Playfair Display, serif", fontSize: ".98rem", color: "var(--navy)", marginBottom: ".5rem" }}>Add many at once</h2>
                <p style={{ fontSize: ".78rem", color: "var(--text-soft)", marginBottom: ".6rem" }}>
                  Pick a category below and every book in this paste gets that category. Or add a 5th column per line for per-line category. Same code overwrites existing book.
                </p>
                <form onSubmit={addBooksBulk}>
                  <div className="field">
                    <label>Category for this batch</label>
                    <select value={bulkBookCategory} onChange={(e) => setBulkBookCategory(e.target.value)}>
                      <option value="">Uncategorized</option>
                      {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label>Books — one per line</label>
                    <textarea rows={6} value={bulkBooksText} onChange={(e) => setBulkBooksText(e.target.value)} placeholder={"SH21, ദേശഭക്തി, എ ബി സി, 2\nHW50, ഒരു കഥ, എക്സ് വൈ ഇസഡ്"} style={{ resize: "vertical" }} />
                  </div>
                  <button type="submit" className="btn full secondary"><Plus size={16} /> Add All Books</button>
                </form>
              </div>
            </Modal>
          )}

          {sheet === "classes" && (
            <Modal title="Manage Classes" onClose={() => setSheet(null)} wide>
              <form onSubmit={addClass} style={{ display: "flex", gap: ".5rem", alignItems: "flex-end", marginBottom: "1rem" }}>
                <div style={{ flex: 1 }}><label>New class name</label><input type="text" value={newClassName} onChange={(e) => setNewClassName(e.target.value)} placeholder="e.g. CLASS-7" /></div>
                <button type="submit" className="btn"><Plus size={16} /> Add</button>
              </form>
              <div className="row-list">
                {classes.map((c) => {
                  const count = students.filter((s) => s.className === c).length;
                  return editingClassOld === c ? (
                    <form key={c} onSubmit={saveEditClass} className="row-card" style={{ flexDirection: "column", alignItems: "stretch", gap: ".5rem" }}>
                      <input type="text" value={editClassName} onChange={(e) => setEditClassName(e.target.value)} required />
                      <div style={{ display: "flex", gap: ".5rem" }}>
                        <button type="submit" className="btn" style={{ flex: 1, justifyContent: "center" }}><Check size={14} /> Save</button>
                        <button type="button" className="btn secondary" style={{ flex: 1, justifyContent: "center" }} onClick={cancelEditClass}><X size={14} /> Cancel</button>
                      </div>
                    </form>
                  ) : (
                    <div key={c} className="row-card">
                      <div><div className="title">{c}</div><div className="meta">{count} student{count === 1 ? "" : "s"}</div></div>
                      <div style={{ display: "flex", gap: ".4rem" }}>
                        <button className="btn secondary" onClick={() => startEditClass(c)} aria-label="Rename class"><Pencil size={13} /></button>
                        <button className="btn secondary" onClick={() => deleteClass(c)} aria-label="Remove class"><Trash2 size={13} /></button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Modal>
          )}

          {sheet === "dashboard" && (
            <Modal title="Dashboard" onClose={() => setSheet(null)} wide>
              <div className="grid-stats">
                <div className="stat-card"><div className="num">{totalCopies}</div><div className="label">Total Books</div></div>
                <div className="stat-card"><div className="num">{availableCopies}</div><div className="label">Available</div></div>
                <div className="stat-card"><div className="num">{activeTx.length}</div><div className="label">Currently Issued</div></div>
                <div className={`stat-card ${overdueTx.length > 0 ? "warn" : ""}`}><div className="num">{overdueTx.length}</div><div className="label">Overdue</div></div>
              </div>
              <div className="stat-card">
                <div className="label" style={{ marginBottom: ".4rem" }}>Students</div>
                <div className="num" style={{ fontSize: "1.1rem" }}>{students.length}</div>
              </div>
              <h3 className="dash-heading">📚 Most Borrowed Books</h3>
              {dashboardStats.mostBorrowed.length === 0 ? <div className="empty">No borrowing activity yet.</div> : (
                <div className="row-list">
                  {dashboardStats.mostBorrowed.map((x, i) => (
                    <div key={x.book.id} className="row-card">
                      <div className="dash-row">
                        <span className="rank">{i < 3 ? ["🥇", "🥈", "🥉"][i] : `#${i + 1}`}</span>
                        <div><div className="title">{x.book.title}</div><div className="meta">{x.book.code}</div></div>
                      </div>
                      <div className="due" style={{ fontWeight: 700 }}>{x.count}×</div>
                    </div>
                  ))}
                </div>
              )}
              <h3 className="dash-heading">🏆 Top Readers <span className="dash-sub">all-time</span></h3>
              {dashboardStats.topReaders.length === 0 ? <div className="empty">No borrowing activity yet.</div> : (
                <div className="row-list">
                  {dashboardStats.topReaders.map((x, i) => (
                    <div key={x.student.id} className="row-card">
                      <div className="dash-row">
                        <span className="rank">{i < 3 ? ["🥇", "🥈", "🥉"][i] : `#${i + 1}`}</span>
                        <div><div className="title">{x.student.name}</div><div className="meta">{x.student.className || "Unassigned"}</div></div>
                      </div>
                      <div className="due" style={{ fontWeight: 700 }}>{x.count} book{x.count === 1 ? "" : "s"}</div>
                    </div>
                  ))}
                </div>
              )}
              <h3 className="dash-heading">🎓 Most Active Class</h3>
              {dashboardStats.topClasses.length === 0 ? <div className="empty">No borrowing activity yet.</div> : (
                <div className="row-list">
                  {dashboardStats.topClasses.map(([cls, count], i) => (
                    <div key={cls} className="row-card">
                      <div className="dash-row">
                        <span className="rank">{i < 3 ? ["🥇", "🥈", "🥉"][i] : `#${i + 1}`}</span>
                        <div className="title">{cls}</div>
                      </div>
                      <div className="due" style={{ fontWeight: 700 }}>{count} book{count === 1 ? "" : "s"}</div>
                    </div>
                  ))}
                </div>
              )}
              <h3 className="dash-heading">📦 Never Borrowed <span className="dash-sub">{dashboardStats.neverBorrowed.length} of {books.length} book{books.length === 1 ? "" : "s"}</span></h3>
              {dashboardStats.neverBorrowed.length === 0 ? <div className="empty">Every book has been borrowed at least once 🎉</div> : (
                <div className="row-list">
                  {dashboardStats.neverBorrowed.slice(0, 8).map((b) => (
                    <div key={b.id} className="row-card"><div><div className="title">{b.title}</div><div className="meta">{b.code}</div></div></div>
                  ))}
                  {dashboardStats.neverBorrowed.length > 8 && <div className="empty" style={{ padding: ".6rem" }}>+{dashboardStats.neverBorrowed.length - 8} more</div>}
                </div>
              )}
            </Modal>
          )}

          {sheet === "overdue" && (
            <Modal title="Overdue Books" onClose={() => setSheet(null)} wide>
              {overdueList.length === 0 ? <div className="empty">Nothing overdue right now.</div> : (
                <div className="row-list">
                  {overdueList.map((r) => {
                    const daysLate = daysBetween(r.tx.dueDate, todayISO()) - (appSettings.graceDays || 0);
                    const fine = Math.max(0, daysLate * (appSettings.finePerDay || 0));
                    return (
                      <div key={r.tx.id} className="row-card overdue">
                        <div>
                          <div className="title">{r.book.title}</div>
                          <div className="meta">{r.student.name} ({r.student.className || "Unassigned"}){r.student.roll ? ` · Roll ${r.student.roll}` : ""}</div>
                          {fine > 0 && <div style={{ color: "var(--danger)", fontSize: ".72rem", fontWeight: 700, marginTop: ".2rem" }}>₹{fine} fine</div>}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
                          <div className="due"><Clock size={12} style={{ verticalAlign: "-2px" }} /> {daysBetween(r.tx.dueDate, todayISO())}d late</div>
                          {r.student.phone && (
                            <a href={waLink(r.student.phone, `നമസ്കാരം ${r.student.name}, "${r.book.title}" (${r.book.code}) എന്ന പുസ്തകം തിരികെ നൽകേണ്ട തീയതി ${formatDate(r.tx.dueDate)} ആയിരുന്നു. നന്ദി.`)}
                              target="_blank" rel="noopener noreferrer" className="btn secondary" style={{ padding: ".4rem .5rem" }}
                              aria-label={`WhatsApp reminder to ${r.student.name}`}
                            ><MessageCircle size={13} /></a>
                          )}
                          <button className="btn secondary" onClick={() => returnBook(r.tx.id)}><RotateCcw size={13} /> Return</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Modal>
          )}

          {sheet === "studentDetail" && detailStudentId && (() => {
            const dStudent = studentById(detailStudentId);
            if (!dStudent) return null;
            const dTx = transactions.filter((t) => t.studentId === detailStudentId).sort((a, b) => (a.issueDate < b.issueDate ? 1 : -1));
            return (
              <Modal title={dStudent.name} onClose={() => setSheet(null)}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: ".9rem" }}>
                  <Avatar name={dStudent.name} photoUrl={dStudent.photoUrl} size={84} />
                  <div style={{ display: "flex", gap: ".6rem", marginTop: ".6rem" }}>
                    <label className="btn secondary" style={{ cursor: "pointer", fontSize: ".8rem", padding: ".4rem .8rem" }}>
                      <Camera size={14} />{photoUploading ? "Uploading..." : dStudent.photoUrl ? "Change Photo" : "Add Photo"}
                      <input type="file" accept="image/*" style={{ display: "none" }} disabled={photoUploading} onChange={(e) => handlePhotoUpload(e, dStudent)} />
                    </label>
                    {dStudent.photoUrl && (
                      <button type="button" className="btn secondary" style={{ fontSize: ".8rem", padding: ".4rem .8rem" }} onClick={() => handleRemovePhoto(dStudent)}><X size={14} /> Remove</button>
                    )}
                  </div>
                  {photoError && <div className="lock-error" style={{ marginTop: ".5rem" }}>{photoError}</div>}
                </div>
                <div className="current-pick" style={{ marginBottom: ".9rem" }}>
                  <span>
                    {dStudent.className || "Unassigned"}{dStudent.roll ? ` · Roll ${dStudent.roll}` : ""}
                    {dStudent.phone ? ` · ${dStudent.phone}` : ""}
                  </span>
                  <div style={{ display: "flex", gap: ".7rem" }}>
                    <button onClick={() => startEditStudent(dStudent)}><Pencil size={12} style={{ verticalAlign: "-1px" }} /> Edit</button>
                    <button onClick={() => deleteStudent(dStudent)}><Trash2 size={12} style={{ verticalAlign: "-1px" }} /> Remove</button>
                  </div>
                </div>
                <div style={{ display: "flex", gap: ".5rem", marginBottom: "1rem" }}>
                  <button className="btn" style={{ flex: 1, justifyContent: "center" }} onClick={() => { setSelectedStudentId(dStudent.id); openIssue(); }}><BookMarked size={15} /> Issue</button>
                  <button className="btn secondary" style={{ flex: 1, justifyContent: "center" }} onClick={() => { setSelectedStudentId(dStudent.id); openReturn(); }}><RotateCcw size={15} /> Return</button>
                </div>
                <button className="btn secondary full" style={{ marginBottom: "1rem" }} onClick={() => openIdCard(dStudent.id)}><CreditCard size={15} /> Digital Library Card</button>
                {editingStudentId === dStudent.id && (
                  <form onSubmit={saveEditStudent} className="row-card" style={{ flexDirection: "column", alignItems: "stretch", gap: ".5rem", marginBottom: "1rem" }}>
                    <input type="text" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} required />
                    <div className="form-grid" style={{ marginBottom: 0 }}>
                      <select value={editForm.className} onChange={(e) => setEditForm({ ...editForm, className: e.target.value })}>
                        <option value="">Unassigned</option>
                        {classes.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <input type="text" value={editForm.roll} onChange={(e) => setEditForm({ ...editForm, roll: e.target.value })} placeholder="Roll (optional)" />
                    </div>
                    <input type="tel" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} placeholder="Phone (optional)" />
                    <div style={{ display: "flex", gap: ".5rem" }}>
                      <button type="submit" className="btn" style={{ flex: 1, justifyContent: "center" }}><Check size={14} /> Save</button>
                      <button type="button" className="btn secondary" style={{ flex: 1, justifyContent: "center" }} onClick={cancelEditStudent}><X size={14} /> Cancel</button>
                    </div>
                  </form>
                )}
                <h2 style={{ fontFamily: "Playfair Display, serif", fontSize: ".98rem", color: "var(--navy)", marginBottom: ".5rem" }}>Book history</h2>
                {dTx.length === 0 ? <div className="empty">No books issued to this student yet.</div> : (
                  <div style={{ overflowX: "auto" }}>
                    <table>
                      <thead><tr><th>#</th><th>Book</th><th>Code</th><th>Issued</th><th>Status</th></tr></thead>
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
                                {t.returnDate ? <span style={{ color: "#1F8A5E", fontWeight: 700 }}>Returned {formatDate(t.returnDate)}</span>
                                  : overdue ? <span style={{ color: "var(--danger)", fontWeight: 700 }}>Overdue · due {formatDate(t.dueDate)}</span>
                                  : <span style={{ color: "var(--indigo)", fontWeight: 700 }}>Not returned · due {formatDate(t.dueDate)}</span>}
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

          {sheet === "bookDetail" && detailBookId && (() => {
            const dBook = bookById(detailBookId);
            if (!dBook) return null;
            const holders = activeTx.filter((t) => t.bookId === dBook.id).map((t) => ({ tx: t, student: studentById(t.studentId) })).filter((h) => h.student);
            const bookHistory = transactions.filter((t) => t.bookId === dBook.id).sort((a, b) => (a.issueDate < b.issueDate ? 1 : -1));
            return (
              <Modal title={dBook.title} onClose={() => setSheet(null)}>
                <div className="book-qr-wrap"><div className="book-qr-box"><QRCodeCanvas value={bookQrValue(dBook.code)} size={150} /></div></div>
                <div style={{ textAlign: "center", fontSize: ".78rem", color: "var(--text-soft)", marginBottom: "1rem" }}>
                  Scan this QR in Issue/Return to pick this book instantly.
                </div>
                <div className="current-pick" style={{ marginBottom: ".9rem" }}>
                  <span>
                    <b>{dBook.code}</b>{dBook.author ? ` · ${dBook.author}` : ""}<br />
                    <span style={{ fontSize: ".78rem", color: "var(--text-soft)" }}>{dBook.category || UNCATEGORIZED} · {dBook.availableCopies}/{dBook.totalCopies} available</span>
                  </span>
                  <div style={{ display: "flex", gap: ".7rem" }}>
                    <button onClick={() => { setSheet("catalog"); startEditBook(dBook); }}><Pencil size={12} style={{ verticalAlign: "-1px" }} /> Edit</button>
                    <button onClick={() => { deleteBook(dBook); setSheet(null); }}><Trash2 size={12} style={{ verticalAlign: "-1px" }} /> Remove</button>
                  </div>
                </div>
                <h2 style={{ fontFamily: "Playfair Display, serif", fontSize: ".98rem", color: "var(--navy)", marginBottom: ".4rem" }}>Currently issued to</h2>
                {holders.length === 0 ? <div className="empty" style={{ padding: ".8rem" }}>Nobody — all copies on the shelf.</div> : (
                  <div className="row-list" style={{ marginBottom: "1rem" }}>
                    {holders.map((h) => {
                      const overdue = h.tx.dueDate < todayISO();
                      return (
                        <div key={h.tx.id} className={`row-card ${overdue ? "overdue" : ""}`}>
                          <div><div className="title">{h.student.name}</div><div className="meta">{h.student.className || "Unassigned"}{h.student.roll ? ` · Roll ${h.student.roll}` : ""}</div></div>
                          <div className="due">{overdue ? "Overdue: " : "Due: "}{formatDate(h.tx.dueDate)}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
                <h2 style={{ fontFamily: "Playfair Display, serif", fontSize: ".98rem", color: "var(--navy)", marginBottom: ".5rem" }}>Full issue history</h2>
                {bookHistory.length === 0 ? <div className="empty">This book has never been issued.</div> : (
                  <div style={{ overflowX: "auto" }}>
                    <table>
                      <thead><tr><th>#</th><th>Student</th><th>Issued</th><th>Status</th></tr></thead>
                      <tbody>
                        {bookHistory.map((t, i) => {
                          const st = studentById(t.studentId);
                          const overdue = !t.returnDate && t.dueDate < todayISO();
                          return (
                            <tr key={t.id}>
                              <td className="mono">{i + 1}</td>
                              <td>{st ? st.name : "—"}</td>
                              <td className="mono">{formatDate(t.issueDate)}</td>
                              <td>
                                {t.returnDate ? <span style={{ color: "#1F8A5E", fontWeight: 700 }}>Returned {formatDate(t.returnDate)}</span>
                                  : overdue ? <span style={{ color: "var(--danger)", fontWeight: 700 }}>Overdue · due {formatDate(t.dueDate)}</span>
                                  : <span style={{ color: "var(--indigo)", fontWeight: 700 }}>Out · due {formatDate(t.dueDate)}</span>}
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

          {sheet === "idCard" && detailStudentId && (() => {
            const cStudent = studentById(detailStudentId);
            if (!cStudent) return null;
            return (
              <Modal title="Digital Library Card" onClose={() => setSheet(null)}>
                <div className="id-card-wrap">
                  <div className="lib-card" ref={cardRef}>
                    <div className="lib-card-top">
                      <div className="lib-card-brand-name">{appSettings.libraryName || "NMMI ISLAMIC LIBRARY"}</div>
                      <div className="lib-card-brand-sub">{appSettings.librarySubtitle || "Nandiyil Muhammed Musliyar Memorial"}</div>
                    </div>
                    <div className="lib-card-body">
                      <Avatar name={cStudent.name} photoUrl={cStudent.photoUrl} size={64} />
                      <div className="lib-card-info">
                        <div className="lib-card-name">{cStudent.name}</div>
                        <div className="lib-card-meta">{cStudent.className || "Unassigned"}{cStudent.roll ? ` · Roll ${cStudent.roll}` : ""}</div>
                      </div>
                    </div>
                    <div className="lib-card-bottom">
                      <div className="lib-card-id-label">LIBRARY MEMBER</div>
                      {cStudent.roll ? <div className="lib-card-qr-wrap"><QRCodeCanvas value={cStudent.roll} size={66} /></div>
                        : <div className="lib-card-id-label" style={{ color: "var(--danger)" }}>Add a roll no. for QR</div>}
                    </div>
                  </div>
                </div>
                <button className="btn full" style={{ marginTop: "1.1rem" }} onClick={() => downloadCard(cStudent)} disabled={cardDownloading}>
                  <Download size={16} /> {cardDownloading ? "Preparing..." : "Download as Image"}
                </button>
                <p style={{ fontSize: ".78rem", color: "var(--text-soft)", textAlign: "center", marginTop: ".6rem" }}>Save this to the student's phone, or print it out.</p>
              </Modal>
            );
          })()}

          {sheet === "promotion" && (() => {
            const countFor = (c) => students.filter((s) => s.className === c).length;
            const movingCount = classes.reduce((n, c) => n + ((promoMap[c] ?? c) !== c ? countFor(c) : 0), 0);
            return (
              <Modal title="Class Promotion" onClose={() => setSheet(null)} wide>
                <p style={{ fontSize: ".8rem", color: "var(--text-soft)", marginBottom: ".8rem", lineHeight: 1.5 }}>
                  Year-end: move every class up in one go. Nothing changes until you tap Apply, and the last promotion can be undone.
                </p>
                <div className="row-list">
                  {classes.map((c) => (
                    <div key={c} className="row-card" style={{ flexDirection: "column", alignItems: "stretch", gap: ".4rem" }}>
                      <div><div className="title">{c}</div><div className="meta">{countFor(c)} student{countFor(c) === 1 ? "" : "s"}</div></div>
                      <select value={promoMap[c] ?? c} onChange={(e) => setPromoMap({ ...promoMap, [c]: e.target.value })}>
                        <option value="">→ Unassigned (passed out)</option>
                        {classes.map((t) => <option key={t} value={t}>{t === c ? `Stay in ${t}` : `→ Move to ${t}`}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
                {promoMsg && (
                  <div style={{ margin: ".8rem 0 0", fontSize: ".84rem", fontWeight: 700, color: promoMsg.startsWith("✅") || promoMsg.startsWith("↩️") ? "#1F8A5E" : "var(--danger)" }}>{promoMsg}</div>
                )}
                <button className="btn full" style={{ marginTop: "1rem" }} disabled={promoBusy || movingCount === 0} onClick={applyPromotion}>
                  <GraduationCap size={16} /> {promoBusy ? "Working..." : `Apply Promotion (${movingCount} students)`}
                </button>
                {lastPromotion && Array.isArray(lastPromotion.moves) && (
                  <button className="btn secondary full" style={{ marginTop: ".6rem" }} disabled={promoBusy} onClick={undoPromotion}>
                    <RotateCcw size={15} /> Undo last promotion ({lastPromotion.moves.length} students, {formatDate(lastPromotion.date)})
                  </button>
                )}
              </Modal>
            );
          })()}

          {sheet === "certificate" && (
            <Modal title="Monthly Certificate" onClose={() => setSheet(null)}>
              <div className="no-print">
                <div className="form-grid">
                  <div><label>Month</label><input type="month" value={certMonth} onChange={(e) => { setCertMonth(e.target.value); setCertStudentId(""); }} /></div>
                  <div>
                    <label>Student (defaults to top reader)</label>
                    <select value={certStudentId} onChange={(e) => setCertStudentId(e.target.value)}>
                      <option value="">{monthlyTopReaders[0] ? `Top reader: ${monthlyTopReaders[0].student.name}` : "No activity yet"}</option>
                      {[...students].sort((a, b) => a.name.localeCompare(b.name)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                </div>
                {monthlyTopReaders.length > 1 && (
                  <p style={{ fontSize: ".76rem", color: "var(--text-soft)", marginBottom: ".8rem" }}>
                    Runners-up: {monthlyTopReaders.slice(1, 4).map((x) => `${x.student.name} (${x.count})`).join(", ")}
                  </p>
                )}
              </div>
              {!certStudent ? (
                <div className="empty">No borrowing activity for this month yet — pick a student above to still generate a certificate.</div>
              ) : (
                <>
                  <div className="id-card-wrap">
                    <div className="certificate" ref={certRef}>
                      <div className="cert-badge">🏆</div>
                      <div className="cert-title">Certificate of Achievement</div>
                      <div className="cert-sub">{appSettings.libraryName || "NMMI Islamic Library"}</div>
                      <div className="cert-presented">This certifies that</div>
                      <div className="cert-name">{certStudent.name}</div>
                      <div className="cert-desc">
                        has been recognized as the <b>Top Reader</b> of <span className="cert-month">{formatMonthLabel(certMonth)}</span>
                        {certCount > 0 ? <>, having borrowed <b>{certCount}</b> book{certCount === 1 ? "" : "s"} this month.</> : "."}
                      </div>
                      <div className="cert-footer">
                        <div className="cert-foot-item"><div className="cert-foot-line" />Date</div>
                        <div className="cert-foot-item"><div className="cert-foot-line" />{appSettings.librarianName || "Librarian"}</div>
                      </div>
                    </div>
                  </div>
                  <button className="btn full no-print" style={{ marginTop: "1.1rem" }} onClick={() => downloadCertificate(certStudent, certMonth)} disabled={certDownloading}>
                    <Download size={16} /> {certDownloading ? "Preparing..." : "Download as Image"}
                  </button>
                </>
              )}
            </Modal>
          )}

          {scannerTarget && (
            isDesktop && !desktopForceCamera ? (
              <DesktopScannerWaiting onClose={() => setScannerTarget(null)} onUseCamera={() => setDesktopForceCamera(true)} feedback={scanFeedback} />
            ) : (
              <Scanner onResult={handleScanResult} onClose={() => setScannerTarget(null)} feedback={scanFeedback} />
            )
          )}
        </>
      )}
    </div>
  );
}
