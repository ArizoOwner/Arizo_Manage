// Synthetic bank SMS / push vectors (PROMPT.md §6.3). No real customer data: every number is made up.
// `at` is the wall-clock time: Jalali in Asia/Tehran for IRR messages, Gregorian in UTC otherwise.
export interface Vector {
  name: string;
  text: string;
  sender?: string;
  expect:
    | { kind: 'rejected'; reason: 'otp' | 'spam' }
    | { kind: 'unparsed' }
    | {
        kind: 'parsed';
        bank?: string | null;
        dir?: 'debit' | 'credit' | null;
        amount: string;
        currency?: string;
        balance?: string | null;
        card?: string | null;
        ref?: string | null;
        merchant?: string | null;
        at?: string | null;
        minConfidence?: number;
        maxConfidence?: number;
      };
}

export const IRANIAN: Vector[] = [
  { name: 'mellat trailing minus multi-line', text: 'بانک ملت\nبرداشت: 2,500,000-\nمانده: 12,340,000\nکارت: 6104***1234\n1403/08/15 14:32', expect: { kind: 'parsed', bank: 'mellat', dir: 'debit', amount: '2500000', balance: '12340000', card: '1234', at: '1403-08-15 14:32', minConfidence: 0.9 } },
  { name: 'mellat deposit plus sign', text: 'بانک ملت\nواریز: 8,000,000+\nمانده: 20,340,000\nحساب: 1234567890\n1403/08/16 09:05', expect: { kind: 'parsed', bank: 'mellat', dir: 'credit', amount: '8000000', balance: '20340000', card: '7890', at: '1403-08-16 09:05' } },
  { name: 'melli persian digits merchant', text: 'بانک ملی ایران\nخرید از فروشگاه افق کوروش\nمبلغ ۱۵۰٬۰۰۰ ریال\nکارت ****۵۶۷۸\nموجودی ۹٬۸۵۰٬۰۰۰ ریال\n۱۴۰۳/۰۸/۲۰-۰۹:۱۵', expect: { kind: 'parsed', bank: 'melli', dir: 'debit', amount: '150000', balance: '9850000', card: '5678', merchant: 'افق کوروش', at: '1403-08-20 09:15' } },
  { name: 'melli arabic digits', text: 'بانك ملي\nبرداشت ٣٠٠,٠٠٠ ريال\nمانده ١,٢٠٠,٠٠٠\n١٤٠٣/٠٩/٠١', expect: { kind: 'parsed', bank: 'melli', dir: 'debit', amount: '300000', balance: '1200000', at: '1403-09-01 12:00' } },
  { name: 'saderat one-line', text: 'بانک صادرات: برداشت 1,250,000 ریال از کارت 6037***9911 مانده 4,750,000 ریال 03/08/22 18:40', expect: { kind: 'parsed', bank: 'saderat', dir: 'debit', amount: '1250000', balance: '4750000', card: '9911', at: '1403-08-22 18:40' } },
  { name: 'tejarat transfer out', text: 'بانک تجارت\nانتقال وجه 5,000,000-\nبه حساب 0123456789\nمانده 15,000,000\nپیگیری 654321', expect: { kind: 'parsed', bank: 'tejarat', dir: 'debit', amount: '5000000', balance: '15000000', ref: '654321' } },
  { name: 'sepah pos purchase', text: 'بانک سپه\nخرید کارتخوان\nمبلغ: 420,000 ریال\nکارت 5892***3344\nمانده: 2,580,000\n1403/07/30 20:11', expect: { kind: 'parsed', bank: 'sepah', dir: 'debit', amount: '420000', balance: '2580000', card: '3344', at: '1403-07-30 20:11' } },
  { name: 'pasargad deposit toman', text: 'بانک پاسارگاد\nواریز 2,000,000 تومان\nموجودی 7,500,000 تومان\n1403/08/01', expect: { kind: 'parsed', bank: 'pasargad', dir: 'credit', amount: '20000000', balance: '75000000', at: '1403-08-01 12:00' } },
  { name: 'saman withdrawal no balance', text: 'بانک سامان\nبرداشت از حساب ...4567\nمبلغ 600,000 ریال\n1403/08/03 11:20', expect: { kind: 'parsed', bank: 'saman', dir: 'debit', amount: '600000', balance: null, card: '4567', at: '1403-08-03 11:20' } },
  { name: 'parsian salary', text: 'بانک پارسیان\nواریز حقوق\nمبلغ 145,000,000 ریال\nمانده 160,000,000 ریال', expect: { kind: 'parsed', bank: 'parsian', dir: 'credit', amount: '145000000', balance: '160000000' } },
  { name: 'keshavarzi atm', text: 'بانک کشاورزی\nبرداشت از خودپرداز\n2,000,000-\nمانده 3,100,000\n1403/06/12 07:45', expect: { kind: 'parsed', bank: 'keshavarzi', dir: 'debit', amount: '2000000', balance: '3100000', at: '1403-06-12 07:45' } },
  { name: 'maskan installment debit', text: 'بانک مسکن\nکسر قسط\nمبلغ 9,850,000 ریال\nمانده 1,150,000 ریال', expect: { kind: 'parsed', bank: 'maskan', dir: 'debit', amount: '9850000', balance: '1150000' } },
  { name: 'refah deposit', text: 'بانک رفاه کارگران\nواریز: 12,000,000\nموجودی: 13,500,000\n1403/05/05 10:00', expect: { kind: 'parsed', bank: 'refah', dir: 'credit', amount: '12000000', balance: '13500000', at: '1403-05-05 10:00' } },
  { name: 'ayandeh purchase', text: 'بانک آینده\nخرید اینترنتی 350,000-\nمانده 8,650,000', expect: { kind: 'parsed', bank: 'ayandeh', dir: 'debit', amount: '350000', balance: '8650000' } },
  { name: 'eghtesad novin zwnj', text: 'بانک اقتصاد‌ نوین\nبرداشت‌: ۷۵۰٬۰۰۰-\nمانده‌: ۲٬۲۵۰٬۰۰۰', expect: { kind: 'parsed', bank: 'eghtesad_novin', dir: 'debit', amount: '750000', balance: '2250000' } },
  { name: 'shahr', text: 'بانک شهر\nواریز 1,500,000+\nمانده 6,500,000\n1403/04/18 16:30', expect: { kind: 'parsed', bank: 'shahr', dir: 'credit', amount: '1500000', balance: '6500000', at: '1403-04-18 16:30' } },
  { name: 'resalat', text: 'بانک قرض الحسنه رسالت\nبرداشت 200,000 ریال\nمانده 800,000 ریال', expect: { kind: 'parsed', bank: 'resalat', dir: 'debit', amount: '200000', balance: '800000' } },
  { name: 'post bank', text: 'پست بانک ایران\nواریز به حساب\nمبلغ 3,300,000\nمانده 4,000,000', expect: { kind: 'parsed', bank: 'post_bank', dir: 'credit', amount: '3300000', balance: '4000000' } },
  { name: 'sina', text: 'بانک سینا\nخرید 98,000-\nکارت 6393***1020\nمانده 1,902,000', expect: { kind: 'parsed', bank: 'sina', dir: 'debit', amount: '98000', balance: '1902000', card: '1020' } },
  { name: 'karafarin', text: 'بانک کارآفرین\nبرداشت 4,400,000-\nمانده 10,600,000\nسند 778899', expect: { kind: 'parsed', bank: 'karafarin', dir: 'debit', amount: '4400000', balance: '10600000', ref: '778899' } },
  { name: 'dey', text: 'بانک دی\nواریز پایا 25,000,000+\nمانده 30,000,000', expect: { kind: 'parsed', bank: 'dey', dir: 'credit', amount: '25000000', balance: '30000000' } },
  { name: 'khavarmianeh', text: 'بانک خاورمیانه\nبرداشت: 1,000,000 ریال\nمانده: 49,000,000 ریال', expect: { kind: 'parsed', bank: 'khavarmianeh', dir: 'debit', amount: '1000000', balance: '49000000' } },
  { name: 'sarmayeh', text: 'بانک سرمایه\nواریز سود سپرده 2,345,678+\nمانده 102,345,678', expect: { kind: 'parsed', bank: 'sarmayeh', dir: 'credit', amount: '2345678', balance: '102345678' } },
  { name: 'gardeshgari', text: 'بانک گردشگری\nخرید 1,200,000-\nمانده 800,000', expect: { kind: 'parsed', bank: 'gardeshgari', dir: 'debit', amount: '1200000', balance: '800000' } },
  { name: 'tosee taavon', text: 'بانک توسعه تعاون\nبرداشت 500,000\nمانده 2,500,000', expect: { kind: 'parsed', bank: 'tosee_taavon', dir: 'debit', amount: '500000', balance: '2500000' } },
  { name: 'iran zamin', text: 'بانک ایران زمین\nواریز 9,000,000\nموجودی 9,500,000', expect: { kind: 'parsed', bank: 'iran_zamin', dir: 'credit', amount: '9000000', balance: '9500000' } },
  { name: 'mehr iran', text: 'بانک قرض الحسنه مهر ایران\nکسر قسط وام 3,000,000-\nمانده 1,000,000', expect: { kind: 'parsed', bank: 'mehr_iran', dir: 'debit', amount: '3000000', balance: '1000000' } },
  { name: 'melal', text: 'موسسه اعتباری ملل\nبرداشت 700,000-\nمانده 300,000', expect: { kind: 'parsed', bank: 'melal', dir: 'debit', amount: '700000', balance: '300000' } },
  { name: 'tosee saderat', text: 'بانک توسعه صادرات\nواریز 50,000,000\nمانده 75,000,000', expect: { kind: 'parsed', bank: 'tosee_saderat', dir: 'credit', amount: '50000000', balance: '75000000' } },
  { name: 'sanat madan', text: 'بانک صنعت و معدن\nبرداشت 6,000,000-\nمانده 14,000,000', expect: { kind: 'parsed', bank: 'sanat_madan', dir: 'debit', amount: '6000000', balance: '14000000' } },
  { name: 'noor', text: 'موسسه اعتباری نور\nواریز 1,000,000\nمانده 2,000,000', expect: { kind: 'parsed', bank: 'noor', dir: 'credit', amount: '1000000', balance: '2000000' } },
  { name: 'negative balance (overdraft)', text: 'بانک ملت\nبرداشت: 1,000,000-\nمانده: 200,000-', expect: { kind: 'parsed', bank: 'mellat', dir: 'debit', amount: '1000000', balance: '-200000' } },
  { name: 'tatweel and rlm', text: 'بانـــک ملـی‏\nبرداشـت 450,000-\nمانـده 550,000', expect: { kind: 'parsed', bank: 'melli', dir: 'debit', amount: '450000', balance: '550000' } },
  { name: 'explicit rial', text: 'بانک ملی\nمبلغ 1,000,000 ریال برداشت شد\nمانده 5,000,000 ریال', expect: { kind: 'parsed', bank: 'melli', dir: 'debit', amount: '1000000', currency: 'IRR', balance: '5000000' } },
  { name: 'explicit toman converts x10', text: 'بانک ملت\nخرید 85,000 تومان\nمانده 1,915,000 تومان', expect: { kind: 'parsed', bank: 'mellat', dir: 'debit', amount: '850000', balance: '19150000' } },
  { name: 'mixed: amount toman, balance rial', text: 'بانک سامان\nخرید 85,000 تومان\nمانده 19,150,000 ریال', expect: { kind: 'parsed', bank: 'saman', dir: 'debit', amount: '850000', balance: '19150000' } },
  { name: 'dash date with time', text: 'بانک ملت\nبرداشت 100,000-\nمانده 900,000\n1403-08-15 08:30', expect: { kind: 'parsed', bank: 'mellat', dir: 'debit', amount: '100000', balance: '900000', at: '1403-08-15 08:30' } },
  { name: 'ref 12 digits never an amount', text: 'بانک ملی\nواریز 5,000,000\nمانده 7,000,000\nشماره پیگیری 123456789012', expect: { kind: 'parsed', bank: 'melli', dir: 'credit', amount: '5000000', balance: '7000000', ref: '123456789012' } },
  { name: 'full 16-digit card never an amount', text: 'بانک ملت\nکارت 6104337712345678\nخرید 250,000\nمانده 750,000', expect: { kind: 'parsed', bank: 'mellat', dir: 'debit', amount: '250000', balance: '750000', card: '5678' } },
  { name: 'time-only never an amount', text: 'بانک ملی\nساعت 14:45\nبرداشت 60,000\nمانده 40,000', expect: { kind: 'parsed', bank: 'melli', dir: 'debit', amount: '60000', balance: '40000' } },
  { name: 'tejarat merchant name', text: 'بانک تجارت\nخرید از اسنپ فود\nمبلغ 640,000-\nمانده 3,360,000', expect: { kind: 'parsed', bank: 'tejarat', dir: 'debit', amount: '640000', balance: '3360000', merchant: 'اسنپ فود' } },
  { name: 'mellat bill payment', text: 'بانک ملت\nپرداخت قبض برق\nمبلغ 1,230,000-\nمانده 8,770,000', expect: { kind: 'parsed', bank: 'mellat', dir: 'debit', amount: '1230000', balance: '8770000' } },
  { name: 'satna large deposit', text: 'بانک پاسارگاد\nواریز ساتنا\nمبلغ 2,500,000,000 ریال\nمانده 3,100,000,000 ریال', expect: { kind: 'parsed', bank: 'pasargad', dir: 'credit', amount: '2500000000', balance: '3100000000' } },
  { name: 'labels with colon spacing', text: 'بانک سپه\nمبلغ : 77,000\nنوع : برداشت\nموجودی : 23,000', expect: { kind: 'parsed', bank: 'sepah', dir: 'debit', amount: '77000', balance: '23000' } },
];

export const NEOBANKS: Vector[] = [
  { name: 'blu deposit toman', text: 'بلو\nواریز 3,000,000 تومان به حساب شما\nمانده: 45,000,000 تومان', expect: { kind: 'parsed', bank: 'blu', dir: 'credit', amount: '30000000', balance: '450000000' } },
  { name: 'blu purchase push', text: 'بلوبانک: خرید 120,000 تومان از دیجی کالا. موجودی: 2,380,000 تومان', expect: { kind: 'parsed', bank: 'blu', dir: 'debit', amount: '1200000', balance: '23800000' } },
  { name: 'blu transfer', text: 'بلو بانک\nانتقال 500,000 تومان به علی\nمانده 1,500,000 تومان', expect: { kind: 'parsed', bank: 'blu', dir: 'debit', amount: '5000000', balance: '15000000' } },
  { name: 'wepod deposit rial', text: 'ویپاد\nواریز 10,000,000 ریال\nموجودی 12,000,000 ریال', expect: { kind: 'parsed', bank: 'wepod', dir: 'credit', amount: '10000000', balance: '12000000' } },
  { name: 'wepod purchase no balance', text: 'ویپاد: پرداخت 250,000 ریال به اسنپ', expect: { kind: 'parsed', bank: 'wepod', dir: 'debit', amount: '250000', balance: null } },
  { name: 'bankino debit', text: 'بانکینو\nبرداشت 900,000 ریال\nمانده 4,100,000 ریال\n1403/08/10 13:13', expect: { kind: 'parsed', bank: 'bankino', dir: 'debit', amount: '900000', balance: '4100000', at: '1403-08-10 13:13' } },
  { name: 'bankino credit persian digits', text: 'بانکینو\nواریز ۲٬۰۰۰٬۰۰۰ تومان\nمانده ۵٬۰۰۰٬۰۰۰ تومان', expect: { kind: 'parsed', bank: 'bankino', dir: 'credit', amount: '20000000', balance: '50000000' } },
];

export const INTERNATIONAL: Vector[] = [
  { name: 'chase card purchase', text: 'Chase: You made a $45.67 transaction with STARBUCKS on Nov 20, 2026 at 8:15 AM ET on card ending in 4321.', expect: { kind: 'parsed', bank: 'chase', dir: 'debit', amount: '4567', currency: 'USD', card: '4321', at: '2026-11-20 08:15' } },
  { name: 'chase deposit', text: 'Chase: A deposit of $2,500.00 was credited to your account ending in 9876. Available balance $3,120.45.', expect: { kind: 'parsed', bank: 'chase', dir: 'credit', amount: '250000', currency: 'USD', balance: '312045', card: '9876' } },
  { name: 'bofa debit', text: 'BofA: $120.00 debited from acct ...5555 on 11/19/2026. Bal: $880.10', expect: { kind: 'parsed', bank: 'bofa', dir: 'debit', amount: '12000', currency: 'USD', balance: '88010', card: '5555', at: '2026-11-19 12:00' } },
  { name: 'citi purchase', text: 'Citi Alert: A $64.20 purchase at AMAZON was made on your card ending in 1111.', expect: { kind: 'parsed', bank: 'citi', dir: 'debit', amount: '6420', currency: 'USD', card: '1111' } },
  { name: 'hsbc pounds', text: 'HSBC: Your card ending 2233 was used for £18.99 at TESCO on 20/11/2026. Balance £1,204.33', expect: { kind: 'parsed', bank: 'hsbc', dir: 'debit', amount: '1899', currency: 'GBP', balance: '120433', card: '2233', at: '2026-11-20 12:00' } },
  { name: 'revolut paid', text: 'Revolut: You paid €12.50 at Lidl. Balance: €340.20', expect: { kind: 'parsed', bank: 'revolut', dir: 'debit', amount: '1250', currency: 'EUR', balance: '34020', merchant: 'Lidl' } },
  { name: 'revolut received', text: 'Revolut: You received €200.00 from Sara. Balance: €540.20', expect: { kind: 'parsed', bank: 'revolut', dir: 'credit', amount: '20000', currency: 'EUR', balance: '54020' } },
  { name: 'wise sent', text: 'Wise: You sent 150.00 EUR to Ali. Your balance is 850.00 EUR.', expect: { kind: 'parsed', bank: 'wise', dir: 'debit', amount: '15000', currency: 'EUR', balance: '85000' } },
  { name: 'wise usd explicit', text: 'Wise: You received 1,000.00 USD. Balance 1,250.50 USD', expect: { kind: 'parsed', bank: 'wise', dir: 'credit', amount: '100000', currency: 'USD', balance: '125050' } },
  { name: 'emirates nbd aed', text: 'Emirates NBD: AED 250.00 spent on your card ending 7788 at CARREFOUR on 20-Nov-2026. Avl Bal AED 4,750.00', expect: { kind: 'parsed', bank: 'emirates_nbd', dir: 'debit', amount: '25000', currency: 'AED', balance: '475000', card: '7788', at: '2026-11-20 12:00' } },
  { name: 'enbd credit', text: 'ENBD: AED 12,000.00 credited to your account XX3456 (salary). Avl Bal AED 15,200.00', expect: { kind: 'parsed', bank: 'emirates_nbd', dir: 'credit', amount: '1200000', currency: 'AED', balance: '1520000', card: '3456' } },
  { name: 'unknown bank english heuristic', text: 'Your account was debited USD 75.00 at UBER. Balance USD 925.00', expect: { kind: 'parsed', bank: null, dir: 'debit', amount: '7500', currency: 'USD', balance: '92500', maxConfidence: 0.85 } },
];

export const HEURISTIC: Vector[] = [
  { name: 'unknown persian bank heuristic', text: 'برداشت 1,200,000 ریال\nمانده 3,800,000 ریال', expect: { kind: 'parsed', bank: null, dir: 'debit', amount: '1200000', balance: '3800000', maxConfidence: 0.85 } },
  { name: 'heuristic picks grouped number, not account', text: 'سپرده 0101234567890 واریز 5,000,000 ریال مانده 7,000,000', expect: { kind: 'parsed', bank: null, dir: 'credit', amount: '5000000', balance: '7000000', card: '7890' } },
  { name: 'heuristic unlabeled amount with toman', text: 'تراکنش 450,000 تومان', expect: { kind: 'parsed', amount: '4500000', dir: null, maxConfidence: 0.6 } },
  { name: 'no amount at all', text: 'بانک ملت\nمشتری گرامی، ساعت کاری شعب تغییر کرد.', expect: { kind: 'unparsed' } },
  { name: 'only a date and a card', text: 'بانک ملی\nکارت 6037***1234\n1403/08/15', expect: { kind: 'unparsed' } },
  { name: 'only a reference id', text: 'پیگیری 99887766', expect: { kind: 'unparsed' } },
  { name: 'trailing minus not confused with date', text: 'بانک سپه\n1403/08/15\nبرداشت 3,000-\nمانده 7,000', expect: { kind: 'parsed', bank: 'sepah', dir: 'debit', amount: '3000', balance: '7000', at: '1403-08-15 12:00' } },
];

export const OTP: Vector[] = [
  { name: 'otp ramz pouya', text: 'رمز پویا شما 123456 است', expect: { kind: 'rejected', reason: 'otp' } },
  { name: 'otp with amount still rejected', text: 'بانک ملت\nرمز پویا: 845123\nمبلغ: 2,000,000 ریال\nپذیرنده: فروشگاه', expect: { kind: 'rejected', reason: 'otp' } },
  { name: 'otp ramz dovom', text: 'رمز دوم یکبار مصرف شما: 99887766', expect: { kind: 'rejected', reason: 'otp' } },
  { name: 'otp yekbar masraf zwnj', text: 'رمز یک‌بار مصرف: ۴۴۵۵۶۶', expect: { kind: 'rejected', reason: 'otp' } },
  { name: 'otp code taeid', text: 'کد تایید شما 4521 است. آن را در اختیار دیگران قرار ندهید', expect: { kind: 'rejected', reason: 'otp' } },
  { name: 'otp code taeid hamza', text: 'کد تأیید: 7788', expect: { kind: 'rejected', reason: 'otp' } },
  { name: 'otp ehraz', text: 'کد احراز هویت: 112233', expect: { kind: 'rejected', reason: 'otp' } },
  { name: 'otp login', text: 'ورود به همراه بانک با کد 5566', expect: { kind: 'rejected', reason: 'otp' } },
  { name: 'otp english', text: 'Your OTP is 774411. Do not share it.', expect: { kind: 'rejected', reason: 'otp' } },
  { name: 'otp verification code', text: 'Your verification code is 3322', expect: { kind: 'rejected', reason: 'otp' } },
  { name: 'otp 2fa', text: 'Use 2FA code 998877 to sign in', expect: { kind: 'rejected', reason: 'otp' } },
  { name: 'otp cvv2', text: 'CVV2 کارت شما تغییر کرد', expect: { kind: 'rejected', reason: 'otp' } },
  { name: 'otp one-time passcode', text: 'Chase: Your one-time passcode is 123987. Expires in 10 minutes.', expect: { kind: 'rejected', reason: 'otp' } },
  { name: 'otp arabic yeh', text: 'رمز پويا: ١٢٣٤٥٦', expect: { kind: 'rejected', reason: 'otp' } },
];

export const SPAM: Vector[] = [
  { name: 'spam jayeze', text: 'شما برنده جایزه 50,000,000 تومانی شدید! همین حالا کلیک کنید', expect: { kind: 'rejected', reason: 'spam' } },
  { name: 'spam ghore keshi', text: 'قرعه کشی بزرگ حساب‌های قرض‌الحسنه با جوایز 1,000,000,000 ریال', expect: { kind: 'rejected', reason: 'spam' } },
  { name: 'spam takhfif', text: 'تخفیف ویژه 30% برای خرید با کارت بانک', expect: { kind: 'rejected', reason: 'spam' } },
  { name: 'spam promo english', text: 'PROMO: get $50 cashback on your next purchase!', expect: { kind: 'rejected', reason: 'spam' } },
  { name: 'spam winner', text: 'Congratulations winner! Claim $1,000 now', expect: { kind: 'rejected', reason: 'spam' } },
];

export const ALL: Vector[] = [...IRANIAN, ...NEOBANKS, ...INTERNATIONAL, ...HEURISTIC, ...OTP, ...SPAM];
