/**
 * lib/sound.ts — أصوات التطبيق (WebAudio — بلا ملفات خارجية).
 * v59 (جولة المستخدم #4): نظام الإشعارات كان صامتاً تماماً — الآن
 * كل إشعار يصدر نغمة مسموعة فور وصوله:
 *   • notifyChime — نغمة إشعار مزدوجة لطيفة (E5→A5) لكل الأنواع
 *     العادية (مخزون/معلومات/بيع أونلاين…).
 *   • alertChime — نغمة تحذير ثلاثية صاعدة للأنواع الحرجة (فشل
 *     النسخ الاحتياطي، فشل رفع دين صِلة، انتهاء الاشتراك) كي
 *     تُميَّز أذنياً عن غيرها.
 * كلاهما أفضل جهد: بلا سياق صوتي أو فشل = صمت بلا استثناء.
 */

type ToneSpec = {freq: number; at: number; duration: number; gain: number};

const CHIME_NORMAL: ToneSpec[] = [
  {freq: 659.25, at: 0, duration: 0.12, gain: 0.09}, // E5
  {freq: 880.0, at: 0.11, duration: 0.18, gain: 0.09}, // A5
];

const CHIME_ALERT: ToneSpec[] = [
  {freq: 523.25, at: 0, duration: 0.11, gain: 0.1}, // C5
  {freq: 659.25, at: 0.1, duration: 0.11, gain: 0.1}, // E5
  {freq: 987.77, at: 0.2, duration: 0.24, gain: 0.11}, // B5
];

let ctx: AudioContext | null = null;

function playTones(tones: ToneSpec[]): void {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as {webkitAudioContext?: typeof AudioContext})
        .webkitAudioContext;
    if (!Ctx) return;
    if (ctx == null) {
      ctx = new Ctx();
    }
    // استئناف السياق إن كان معلقاً (سياسة التشغيل التلقائي) — أول
    // تفاعل مستخدم يوقظه وتبقى النغمات تعمل بعده.
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }
    const now = ctx.currentTime;
    for (const tone of tones) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = tone.freq;
      gain.gain.setValueAtTime(0, now + tone.at);
      gain.gain.linearRampToValueAtTime(tone.gain, now + tone.at + 0.015);
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        now + tone.at + tone.duration,
      );
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + tone.at);
      osc.stop(now + tone.at + tone.duration + 0.02);
    }
  } catch {
    /* بلا صوت — ليست حرجة */
  }
}

/** نغمة الإشعار العادية (مزدوجة لطيفة). */
export function notifyChime(): void {
  playTones(CHIME_NORMAL);
}

/** نغمة التحذير الحرجة (ثلاثية صاعدة). */
export function alertChime(): void {
  playTones(CHIME_ALERT);
}
