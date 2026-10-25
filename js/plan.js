// Onboarding plan generator: turns a decision record into a personalised, week-by-week path to opening day.
// Durations are illustrative assumptions (editable in code), not brand policy.

const ADD_WEEKS = (d, w) => new Date(d.getTime() + w * 7 * 864e5);
const fmtDate = d => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export function trainingTrack(exp) {
  if (!Number.isFinite(exp) || exp < 2) return {
    name: 'Foundation track', days: 10,
    why: 'Little or no shop-running experience — learns retail basics before brand specifics.',
    modules: ['Retail basics: opening/closing, cash handling, daily register', 'Customer service & complaint handling', 'Inventory: receiving, stock counts, re-orders', 'POS & billing system', 'Brand standards, visual merchandising', 'Local marketing & first-week playbook', '5 days of shadowing at a live store'],
  };
  if (exp < 6) return {
    name: 'Standard track', days: 6,
    why: 'Has run or managed a shop — focuses on brand systems rather than retail basics.',
    modules: ['Brand standards & product training', 'POS, inventory & reporting systems', 'Staff hiring & rostering', 'Local launch marketing', '2 days of shadowing at a live store'],
  };
  return {
    name: 'Fast-track', days: 3,
    why: `${exp} years of retail — a brand-systems sprint; candidate to mentor newer partners later.`,
    modules: ['Brand standards & product deep-dive', 'POS, inventory & reporting systems', 'Launch marketing plan', 'Optional: mentor-partner programme'],
  };
}

export function buildPlan(r, today = new Date()) {
  const a = r.app, o = r.outcome;
  if (!['SHORTLIST', 'SHORTLIST_CONDITIONAL', 'PREQUALIFIED', 'WAITLIST'].includes(o)) return null;
  const lang = a.language || 'English';
  const track = trainingTrack(a.experience);
  const tasks = [];
  let w = 0;
  const add = (stage, task, owner, weeks, why, evidence) => { tasks.push({ stage, task, owner, start: w, weeks, why, evidence }); return tasks.length; };

  // 1. Due diligence
  add('Due diligence', 'KYC: PAN, Aadhaar, GST/business registration', 'Partner', 1, 'Confirms identity and legal ability to sign.', 'Documents uploaded & verified');
  const ratio = r.factors?.ratio;
  add('Due diligence', ratio !== null && ratio < 1 ? `Proof of funds for ₹${a.investment} lakh + financing plan for the gap to the ~₹${r.factors.budget} lakh budget` : `Proof of funds for ₹${a.investment} lakh`, 'Partner → Finance', 1, 'Stated capital is unverified until we see it.', 'Bank statement / sanction letter');
  add('Due diligence', a.business ? `Reference check on current business: "${a.business.slice(0, 60)}"` : 'Reference check', 'Expansion manager', 1, 'Validates the retail experience claimed.', 'Call notes');
  for (const s of r.notes?.signals || []) if (['co_investor', 'other_franchise', 'owner_bandwidth', 'commitment', 'funding_dependency'].includes(s.key))
    add('Due diligence', s.text, 'Expansion manager', 1, 'Raised by the applicant\'s own notes.', 'Written confirmation');
  w += 2;

  // 2. Site
  if (o === 'PREQUALIFIED') {
    const alt = r.alternatives?.length ? ` (start with ${r.alternatives.map(x => x.pin).join(', ')})` : '';
    add('Site', `Find a shop in a free pin of an open territory${alt}`, 'Partner + Expansion manager', 4, 'No slot can be held until a specific site is approved.', 'Pin, sq ft, floor, lease/ownership proof');
    w += 4;
  }
  add('Site', 'Site visit: frontage, footfall count, access, signage visibility', 'Expansion manager', 1, 'The workbook has no footfall data — this is where we get it.', 'Site audit form + photos');
  if (r.nearestStore) add('Site', `Catchment check vs ${r.nearestStore.store.id} (~${r.nearestStore.km} km away)`, 'Expansion manager', 1, 'Avoid taking sales from our own store (cannibalisation).', 'Catchment note signed off');
  if (a.space === 'Rented' || a.space === 'Identified') add('Site', 'Lease review: tenure, lock-in, rent escalation, landlord NOC for signage', 'Legal', 1, 'Rent is the biggest fixed cost and drives payback.', 'Lease draft approved');
  if (a.space === 'Owned') add('Site', 'Title deed / ownership check', 'Legal', 1, 'Owned premises remove rent risk — verify title.', 'Title documents');
  if (a.floor === 'Mall unit') add('Site', 'Mall management approval & fit-out guidelines', 'Partner', 2, 'Malls have their own design and hours rules.', 'Mall NOC');
  if (a.floor === 'Upper') add('Site', 'Signage & access plan for upper floor', 'Design team', 1, 'Upper floors lose walk-ins without strong signage.', 'Approved signage plan');
  w += 2;

  // 3. Agreement
  add('Agreement', 'Letter of Intent → franchise agreement signed, fees paid', 'Partner + Legal', 2, 'Formal commitment from both sides.', 'Signed agreement');
  add('Agreement', 'Shop & Establishment registration, trade licence, GST for the store', 'Partner', 2, 'Needed to trade legally in Karnataka.', 'Registration certificates');
  w += 2;

  // 4. Fit-out & hiring
  const fit = a.floor === 'Mall unit' ? 6 : 5;
  add('Store setup', 'Store design, fit-out, signage', 'Design team + Partner', fit, 'Brand-standard look and feel.', 'Fit-out snag list closed');
  add('Store setup', 'POS, internet, CCTV, inventory first load', 'IT + Supply chain', 2, 'Store must bill and stock on day one.', 'Test bills printed');
  add('People', 'Hire 2–4 store staff', 'Partner', 3, 'Staff need training before launch.', 'Offer letters');
  const trainStart = w + fit - 3;
  tasks.push({ stage: 'Training', task: `${track.name} in ${lang} (${track.days} days)`, owner: 'Training team', start: trainStart, weeks: Math.ceil(track.days / 5), why: track.why, evidence: 'Assessment passed', modules: track.modules });
  if (r.nearestStore) tasks.push({ stage: 'Training', task: `Shadowing at ${r.nearestStore.store.id} (pin ${r.nearestStore.store.pin})`, owner: 'Store manager, ' + r.nearestStore.store.id, start: trainStart + 1, weeks: 1, why: 'Nearest live store — learning on a real floor.', evidence: 'Shadow log' });
  w += fit;

  // 5. Launch
  add('Launch', 'Go / no-go gate: agreement, fit-out, systems, stock, training all green', 'Regional head', 1, 'One checklist decides opening day — no surprises.', 'Signed go-live checklist');
  w += 1;
  add('Launch', 'Opening week support + local launch marketing', 'Ops + Marketing', 1, 'First weeks set the store\'s habits.', 'Day-7 review');
  add('After launch', '30 / 60 / 90-day reviews: sales, stock, staff, customer feedback', 'Area manager', 12, 'Catches problems early; feeds partner health score.', 'Review notes');

  const totalWeeks = w + 1;
  const criticalMonths = Math.round(totalWeeks / 4.33 * 10) / 10;
  const targetMonths = Number.isFinite(a.launch) ? a.launch : null;
  const openMonths = Math.max(criticalMonths, targetMonths ?? 0);
  const openDate = ADD_WEEKS(today, Math.round(openMonths * 4.33));
  let feasibility = 'on track';
  if (targetMonths !== null && targetMonths + 0.5 < criticalMonths) feasibility = `target of ${targetMonths} mo is ~${Math.round((criticalMonths - targetMonths) * 10) / 10} mo too tight`;
  else if (targetMonths === null) feasibility = 'no target given — planned on the critical path';

  return { tasks, track, language: lang, totalWeeks, criticalMonths, targetMonths, openDate: fmtDate(openDate), feasibility, provisional: o !== 'SHORTLIST' };
}

// Short WhatsApp-ready message in the partner's language. Hand-written templates, no machine translation at runtime.
export function partnerMessage(r) {
  const a = r.app, lang = a.language || 'English', name = a.name.split(' ')[0] || a.name;
  const asks = r.decision.next.slice(0, 3);
  const T = {
    English: {
      SHORTLIST: `Hi ${name}, good news — your franchise application ${a.id} is provisionally shortlisted for pin ${a.pin}. Next: ${asks.join('; ')}. Our expansion manager will call you within 2 working days.`,
      SHORTLIST_CONDITIONAL: `Hi ${name}, your application ${a.id} is shortlisted for pin ${a.pin}, subject to a few details: ${asks.join('; ')}. Please share these within 14 days so we can hold your slot.`,
      PREQUALIFIED: `Hi ${name}, thank you for applying (${a.id}). Your profile looks good. Please find a shop space — ${asks.slice(1).join('; ')} — and we will start your background checks meanwhile.`,
      WAITLIST: `Hi ${name}, thank you for applying (${a.id}). All slots in your area are currently taken, so you are on our waitlist. We will contact you as soon as a slot opens.`,
      RELOCATE: `Hi ${name}, thank you for applying (${a.id}). We cannot open at pin ${a.pin}, but we would like to work with you at another location. ${asks[0] || ''}`,
      HOLD: `Hi ${name}, thank you for applying (${a.id}). To review your application we need: ${asks.join('; ')}. Please reply with these details.`,
      OUT_OF_PLAN: `Hi ${name}, thank you for applying (${a.id}). Pin ${a.pin} is not in our current expansion area. ${asks[0] || ''}`,
    },
    Hindi: {
      SHORTLIST: `नमस्ते ${name} जी, खुशखबरी — आपका फ्रैंचाइज़ आवेदन ${a.id} पिन ${a.pin} के लिए अस्थायी रूप से शॉर्टलिस्ट हुआ है। हमारे एक्सपेंशन मैनेजर 2 कार्य-दिवसों में आपको कॉल करेंगे।`,
      SHORTLIST_CONDITIONAL: `नमस्ते ${name} जी, आपका आवेदन ${a.id} पिन ${a.pin} के लिए शॉर्टलिस्ट हुआ है, कुछ जानकारी की शर्त पर। कृपया 14 दिनों में दुकान का साइज़ और मंज़िल की जानकारी भेजें ताकि आपका स्लॉट सुरक्षित रहे।`,
      PREQUALIFIED: `नमस्ते ${name} जी, आवेदन (${a.id}) के लिए धन्यवाद। आपकी प्रोफ़ाइल अच्छी है। कृपया दुकान की जगह ढूँढें — तब तक हम आपकी जाँच प्रक्रिया शुरू कर रहे हैं।`,
      WAITLIST: `नमस्ते ${name} जी, आवेदन (${a.id}) के लिए धन्यवाद। आपके क्षेत्र के सभी स्लॉट अभी भरे हैं, इसलिए आप प्रतीक्षा सूची में हैं। स्लॉट खुलते ही हम संपर्क करेंगे।`,
      RELOCATE: `नमस्ते ${name} जी, आवेदन (${a.id}) के लिए धन्यवाद। पिन ${a.pin} पर स्टोर नहीं खुल सकता, पर हम आपके साथ किसी दूसरी जगह काम करना चाहेंगे।`,
      HOLD: `नमस्ते ${name} जी, आवेदन (${a.id}) के लिए धन्यवाद। आगे बढ़ने के लिए हमें कुछ और जानकारी चाहिए — हमारी टीम आपको कॉल करेगी।`,
      OUT_OF_PLAN: `नमस्ते ${name} जी, आवेदन (${a.id}) के लिए धन्यवाद। पिन ${a.pin} अभी हमारे विस्तार क्षेत्र में नहीं है।`,
    },
    Kannada: {
      SHORTLIST: `ನಮಸ್ಕಾರ ${name} ಅವರೇ, ಶುಭ ಸುದ್ದಿ — ನಿಮ್ಮ ಫ್ರಾಂಚೈಸ್ ಅರ್ಜಿ ${a.id} ಪಿನ್ ${a.pin} ಗಾಗಿ ತಾತ್ಕಾಲಿಕವಾಗಿ ಆಯ್ಕೆಯಾಗಿದೆ. ನಮ್ಮ ವಿಸ್ತರಣಾ ವ್ಯವಸ್ಥಾಪಕರು 2 ಕೆಲಸದ ದಿನಗಳಲ್ಲಿ ನಿಮಗೆ ಕರೆ ಮಾಡುತ್ತಾರೆ.`,
      SHORTLIST_CONDITIONAL: `ನಮಸ್ಕಾರ ${name} ಅವರೇ, ನಿಮ್ಮ ಅರ್ಜಿ ${a.id} ಪಿನ್ ${a.pin} ಗಾಗಿ ಆಯ್ಕೆಯಾಗಿದೆ, ಕೆಲವು ವಿವರಗಳ ಷರತ್ತಿನೊಂದಿಗೆ. ನಿಮ್ಮ ಸ್ಲಾಟ್ ಉಳಿಸಲು ದಯವಿಟ್ಟು 14 ದಿನಗಳಲ್ಲಿ ಅಂಗಡಿಯ ಗಾತ್ರ ಮತ್ತು ಮಹಡಿ ವಿವರ ಕಳುಹಿಸಿ.`,
      PREQUALIFIED: `ನಮಸ್ಕಾರ ${name} ಅವರೇ, ಅರ್ಜಿಗೆ (${a.id}) ಧನ್ಯವಾದಗಳು. ನಿಮ್ಮ ಪ್ರೊಫೈಲ್ ಉತ್ತಮವಾಗಿದೆ. ದಯವಿಟ್ಟು ಅಂಗಡಿ ಸ್ಥಳವನ್ನು ಹುಡುಕಿ — ಅಷ್ಟರಲ್ಲಿ ನಾವು ಪರಿಶೀಲನೆ ಪ್ರಾರಂಭಿಸುತ್ತೇವೆ.`,
      WAITLIST: `ನಮಸ್ಕಾರ ${name} ಅವರೇ, ಅರ್ಜಿಗೆ (${a.id}) ಧನ್ಯವಾದಗಳು. ನಿಮ್ಮ ಪ್ರದೇಶದ ಎಲ್ಲಾ ಸ್ಲಾಟ್‌ಗಳು ಸದ್ಯ ಭರ್ತಿಯಾಗಿವೆ, ಆದ್ದರಿಂದ ನೀವು ಕಾಯುವ ಪಟ್ಟಿಯಲ್ಲಿದ್ದೀರಿ. ಸ್ಲಾಟ್ ಲಭ್ಯವಾದ ತಕ್ಷಣ ಸಂಪರ್ಕಿಸುತ್ತೇವೆ.`,
      RELOCATE: `ನಮಸ್ಕಾರ ${name} ಅವರೇ, ಅರ್ಜಿಗೆ (${a.id}) ಧನ್ಯವಾದಗಳು. ಪಿನ್ ${a.pin} ನಲ್ಲಿ ಮಳಿಗೆ ತೆರೆಯಲು ಸಾಧ್ಯವಿಲ್ಲ, ಆದರೆ ಬೇರೆ ಸ್ಥಳದಲ್ಲಿ ನಿಮ್ಮೊಂದಿಗೆ ಕೆಲಸ ಮಾಡಲು ಬಯಸುತ್ತೇವೆ.`,
      HOLD: `ನಮಸ್ಕಾರ ${name} ಅವರೇ, ಅರ್ಜಿಗೆ (${a.id}) ಧನ್ಯವಾದಗಳು. ಮುಂದುವರಿಯಲು ನಮಗೆ ಇನ್ನಷ್ಟು ಮಾಹಿತಿ ಬೇಕು — ನಮ್ಮ ತಂಡ ನಿಮಗೆ ಕರೆ ಮಾಡುತ್ತದೆ.`,
      OUT_OF_PLAN: `ನಮಸ್ಕಾರ ${name} ಅವರೇ, ಅರ್ಜಿಗೆ (${a.id}) ಧನ್ಯವಾದಗಳು. ಪಿನ್ ${a.pin} ಸದ್ಯ ನಮ್ಮ ವಿಸ್ತರಣಾ ಪ್ರದೇಶದಲ್ಲಿಲ್ಲ.`,
    },
  };
  const msg = (T[lang] || T.English)[r.outcome] || T.English[r.outcome] || '';
  return { lang, text: msg, english: T.English[r.outcome] || '' };
}
