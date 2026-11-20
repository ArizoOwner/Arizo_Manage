# Security policy · سیاست امنیتی

## Reporting a vulnerability

Please **do not** open a public issue for a security problem. Report it privately through GitHub's **Report a vulnerability** button (Security → Advisories) on [ArizoOwner/Arizo_Manage](https://github.com/ArizoOwner/Arizo_Manage/security/advisories/new).

Include the affected version or commit, the platform (Android APK or iPhone PWA), steps to reproduce and the impact. Never send real financial data, PINs, passphrases, Recovery Keys or `.arizo` files that hold real data.

You will get an answer as soon as possible. Please give a reasonable time to fix the problem before you disclose it. Good-faith research that follows this policy and the [LICENSE](LICENSE) will not be pursued.

## Scope

In scope: vault encryption and key handling, PIN/biometric lock, the `.arizo` backup format, the SMS firewall and parser, the WebView network firewall, CSP, and data leaks into logs, notifications, URLs or exports.

Out of scope: attacks that need an unlocked, already-compromised or rooted device; social engineering; builds the Owner did not publish.

The threat model and known residual risks are in [docs/security.md](docs/security.md).

## Official builds

Only APKs signed with the Owner's release key and published from this repository are official. Check the signing certificate as described in [docs/distribution_fa.md](docs/distribution_fa.md) before installing.

---

<div dir="rtl">

## گزارش آسیب‌پذیری

لطفاً مشکل امنیتی را در issue عمومی **ننویسید**. آن را به‌صورت خصوصی با دکمهٔ **Report a vulnerability** در بخش Security مخزن گزارش دهید.

نسخه یا commit، سکو (APK اندروید یا وب‌اپ آیفون)، مراحل بازتولید و اثر مشکل را بنویسید. هرگز دادهٔ مالی واقعی، رمز، عبارت عبور، کلید بازیابی یا فایل `.arizo` حاوی دادهٔ واقعی نفرستید.

لطفاً پیش از افشای عمومی، فرصت معقولی برای رفع مشکل بدهید. پژوهش با حسن نیت که طبق این سیاست و [مجوز](LICENSE.fa.md) انجام شود پیگرد نخواهد شد.

## نسخه‌های رسمی

فقط APKهایی رسمی‌اند که با کلید انتشار مالک امضا شده و از همین مخزن منتشر شده‌اند. پیش از نصب، گواهی امضا را طبق [راهنمای توزیع](docs/distribution_fa.md) بررسی کنید.

</div>
