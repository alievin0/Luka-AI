import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "إفصاح العمولات — Luka",
  description:
    "كيف بيربح Luka، وشو يعني رابط تسويق بالعمولة، وشو بيعني هاد إلك كمشتري.",
};

/**
 * The affiliate disclosure page.
 *
 * Both Amazon Associates' operating agreement and consumer-protection rules in
 * most markets require a clear, conspicuous disclosure. This page is the full
 * version; the footer on every screen carries the short one and links here.
 */
export default function DisclosurePage() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-12 leading-relaxed">
      <a href="/" className="text-sm font-medium text-brand-600 hover:underline">
        ← رجوع لـ Luka
      </a>

      <h1 className="mt-6 text-2xl font-bold">إفصاح عن روابط العمولة</h1>

      <p className="mt-5 text-slate-700">
        Luka بيدوّر بالمتاجر الحقيقية على الإنترنت وبيرجّعلك أفضل الخيارات مع
        روابط مباشرة للمتجر. بعض هالروابط هي <strong>روابط تسويق بالعمولة</strong>.
      </p>

      <h2 className="mt-8 text-lg font-bold">شو يعني هاد؟</h2>
      <p className="mt-3 text-slate-700">
        إذا ضغطت على رابط منتج واشتريته من المتجر، المتجر بيدفعلنا عمولة بسيطة
        مقابل إنه وصلتلهم عن طريقنا. <strong>السعر اللي بتدفعه ما بيتغير أبداً</strong> —
        بتدفع نفس السعر تماماً كأنك دخلت عالمتجر مباشرة.
      </p>

      <h2 className="mt-8 text-lg font-bold">هل هاد بيأثر على الترشيحات؟</h2>
      <p className="mt-3 text-slate-700">
        لأ. Luka بيقارن الخيارات على أساس السعر والتقييمات والمواصفات — مش على
        أساس أي متجر بيدفع عمولة أعلى. وبتطلعلك كمان منتجات من متاجر ما إلنا معها
        أي اتفاقية، لأنه المهم يوصلك الخيار الصح.
      </p>

      <h2 className="mt-8 text-lg font-bold">الأسعار</h2>
      <p className="mt-3 text-slate-700">
        الأسعار اللي بتشوفها تقريبية وبتتغير باستمرار وبتختلف حسب بلدك. السعر
        المعتمد دايماً هو اللي بصفحة المتجر وقت الشراء.
      </p>

      <h2 className="mt-8 text-lg font-bold">الشراء والدفع</h2>
      <p className="mt-3 text-slate-700">
        Luka ما بيبيع ولا بيستلم دفعات ولا بيعمل طلبات. السلة هون مجرد قائمة
        حفظ بروابط. الشراء والدفع والشحن والإرجاع كلها بتصير على موقع المتجر
        نفسه وحسب شروطه، والمتجر هو المسؤول عن طلبك.
      </p>

      <h2 className="mt-8 text-lg font-bold">خصوصيتك</h2>
      <p className="mt-3 text-slate-700">
        لما تضغط على رابط منتج، بنسجّل إنه صار ضغط على هاد المنتج وعلى أي متجر —
        عشان نعرف شو المفيد نعرضه. ما بنبيع بياناتك ولا بنشاركها مع حدا خارج
        هالغرض.
      </p>

      <p className="mt-10 text-sm text-slate-500">
        أي سؤال أو ملاحظة؟ تواصل معنا وبنرد عليك.
      </p>
    </main>
  );
}
