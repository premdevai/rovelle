/**
 * The UI string source, in English.
 *
 * Every user-visible word in the app lives here and nowhere else. The other
 * locales are generated from this file by `npm run locales` (Sarvam Translate)
 * and committed to disk, so there is no translation cost at request time.
 *
 * Adding a string: add it here, run the generator, commit. TypeScript will
 * point at every locale that has fallen behind.
 */

export const en = {
  // ——— chrome ———
  "nav.cookbook": "Cookbook",
  "nav.import": "Import",
  "nav.settings": "Settings",
  "nav.signIn": "Sign in",
  "nav.signOut": "Sign out",

  // ——— S10 auth ———
  "auth.tagline": "The cooking videos you save, turned into a cookbook that stays yours.",
  "auth.email": "Email",
  "auth.code": "Six-digit code",
  "auth.sendCode": "Send me a code",
  "auth.enter": "Enter",
  "auth.working": "One moment",
  "auth.noPassword": "No password. We send a six-digit code.",
  "auth.otherEmail": "Use a different email",
  "auth.codeHint": "No mail provider is wired yet, so here it is",
  "auth.badCode": "That code is wrong or has expired. Ask for a new one.",

  // ——— S1 import ———
  "import.firstTitle": "Paste your first link.",
  "import.title": "Add a recipe.",
  "import.firstSub": "It takes about fifteen seconds.",
  "import.sub": "A link, a caption, or a photo of a handwritten page.",
  "import.placeholder": "Paste a link from Instagram, TikTok, or YouTube",
  "import.action": "Import",
  "import.reading": "Reading it",
  "import.left": "imports left this month",
  "import.pasteInstead": "Or paste the caption or transcript instead",
  "import.pasteLabel": "Caption or transcript",
  "import.build": "Build the recipe",
  "import.characters": "characters",
  "import.photo": "Or read a photo — a handwritten card, a cookbook page, a screenshot",
  "import.exhausted":
    "You've used your five imports this month. Cook Mode stays open on everything you already have — only importing is capped.",
  "import.videoLive": "Downloading and listening to the video",
  "import.videoOff": "Reading captions only",

  // ——— S2 progress ———
  "progress.title": "Reading it.",
  "progress.fetch": "Reading the video",
  "progress.transcribe": "Listening for the steps",
  "progress.extract": "Pulling out ingredients",
  "progress.validate": "Building the recipe",
  "progress.cancel": "Cancel",
  // Keyed off elapsed time, not video length — it once told someone their
  // 12-second Short was a "longer video". Say what is actually true.
  "progress.long":
    "This one's taking a while. It keeps going if you leave this page, and it'll be in your cookbook when it's done.",
  "progress.recover":
    "Nothing is lost. The caption route works on everything, and it doesn't cost you an import.",

  // ——— S3 review ———
  "review.eyebrow": "Check it over",
  "review.save": "Save to cookbook",
  "review.saveAndCook": "Save and cook now",
  "review.justSave": "Just save it",
  "review.edited": "edited — your version wins",
  "review.unedited": "unedited draft",
  "review.checkFlag": "check",
  "review.fromSpeech": "came from speech rather than written text. They're marked",
  "review.noAmount":
    "have no stated amount. We left them blank rather than guess — fill them in as you cook.",

  // ——— S4 recipe ———
  "recipe.total": "Total",
  "recipe.serves": "Serves",
  "recipe.level": "Level",
  "recipe.ingredients": "Ingredients",
  "recipe.tools": "Tools",
  "recipe.method": "Method",
  "recipe.storage": "Storage",
  "recipe.source": "Source",
  "recipe.notes": "Notes",
  "recipe.original": "original",
  "recipe.startCooking": "Start cooking",
  "recipe.openRecipe": "Open recipe",
  "recipe.edit": "Edit",
  "recipe.exportJson": "Export JSON",
  "recipe.exportMd": "Markdown",
  "recipe.cooked": "Cooked",
  "recipe.lastCooked": "Last cooked",
  "recipe.readIn": "Read it in",
  "recipe.toTaste": "to taste",
  "recipe.asNeeded": "as needed",
  "recipe.optional": "optional",
  "recipe.addNote": "Add a note",
  "recipe.saveNote": "Save note",
  "recipe.cancel": "Cancel",
  "recipe.remove": "Remove",
  "recipe.notePrompt":
    "Your substitution, your timing, your mum's margin note. This is the part that makes it yours.",
  "recipe.noteWho": "Who said it — Mum, you, anyone",

  // ——— S6 cook mode ———
  "cook.now": "Cooking now",
  "cook.step": "Step",
  "cook.of": "of",
  "cook.markDone": "Mark step done",
  "cook.finish": "Finish cooking",
  "cook.back": "Back",
  "cook.next": "Next",
  "cook.previous": "Previous",
  "cook.exit": "Exit",
  "cook.ingredients": "Ingredients",
  "cook.viewAll": "View all",
  "cook.stepTimer": "Step timer",
  "cook.remaining": "remaining · tap to pause",
  "cook.paused": "paused · tap to resume",
  "cook.timesUp": "time's up · tap when ready",
  "cook.resting": "resting",
  "cook.holdToAsk": "Hold to ask",
  "cook.listening": "Listening — let go to ask",
  "cook.thinking": "Thinking",
  "cook.leaveConfirm": "Leave cook mode? Your progress is saved.",
  "cook.resume": "Pick up at step",
  "cook.startOver": "Start again from the top",
  "cook.vessel": "In",
  "cook.heat": "Heat",
  // "Ready when" translated as "ready when you are" — ambiguous in English,
  // so it was ambiguous to the model too. Say what it means.
  "cook.doneWhen": "Look for",
  "cook.handsFree": "You can walk away",
  "cook.freeOn": "Hands-free on",
  "cook.freeOff": "Hands-free",
  "cook.wake": "Say \u201cchef\u201d, then ask",
  "cook.heard": "Heard",
  // Once the wake word has opened the conversation the cook shouldn't have to
  // say it again for every follow-up \u2014 these three are the states of that
  // window: open and waiting, answering, and reading the answer back.
  "cook.ready": "Listening \u2014 just ask",
  "cook.speaking": "Speaking",
  "cook.stopSpeaking": "Stop",
  "cook.micDenied":
    "The microphone is blocked. Allow it in your browser settings, or use hold-to-ask.",
  "cook.waveOn": "Wave to talk on",
  "cook.waveOff": "Wave to talk",
  "cook.waved": "Waved — listening",
  "cook.wavePrivacy": "Camera stays on your device. Nothing is recorded or sent.",
  "cook.waveHint": "Wave at the phone to start talking.",
  "cook.noCamera": "No camera here — the button and the wake word still work.",

  // ——— S7 done ———
  "done.title": "Cooked.",
  "done.howWasIt": "How did it go?",
  "done.notePlaceholder": "Too much chilli. Half next time.",
  "done.skip": "Skip",

  // ——— S8 cookbook ———
  "book.title": "Cookbook",
  "book.recipes": "recipes",
  "book.notes": "notes",
  "book.search": "Search titles, ingredients, creators",
  "book.sort": "Sort",
  "book.sortCooked": "last cooked",
  "book.sortAdded": "recently added",
  "book.sortTitle": "title",
  "book.apply": "Apply",
  "book.notCooked": "not cooked yet",
  "book.draft": "draft",
  "book.noMatch": "Nothing matches",
  "book.clear": "Clear the search",

  // ——— S9 settings ———
  "settings.title": "Settings",
  "settings.account": "Account",
  "settings.yourCookbook": "Your cookbook",
  "settings.cooksLogged": "cooks logged",
  "settings.export": "Export",
  "settings.exportBlurb":
    "Everything, as RRF JSON. It is the exact document we store — export, re-import, identical result. Permanence is the pitch, so this ships at launch rather than being promised.",
  "settings.download": "Download cookbook JSON",
  "settings.language": "Language",
  "settings.languageBlurb":
    "The app's own words. Recipes carry their own language setting, on the recipe itself.",
  "settings.capabilities": "Sarvam AI",
  "settings.plan": "Plan",
  "settings.planBlurb":
    "Cook Mode is fully unlocked on Free, timers and all. Only importing is capped.",
  "settings.unlimited": "unlimited imports",
  "settings.live": "live",
  "settings.local": "local",

  // ——— shared ———
  "common.loading": "One moment",
  "common.somethingWrong": "Something went wrong.",
} as const;

export type StringKey = keyof typeof en;
export type Dictionary = Record<StringKey, string>;
