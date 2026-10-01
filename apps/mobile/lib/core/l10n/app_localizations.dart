import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';

/// Localization delegate for the Indian Language Set.
///
/// Supported locales: en, hi, ta, te, mr, bn, gu, kn, ar.
/// Strings are loaded from the [_localizedValues] map. In production these
/// would come from ARB files; this implementation provides the delegate
/// infrastructure and a representative set of keys.
class AppLocalizations {
  AppLocalizations(this.locale);

  final Locale locale;

  static AppLocalizations of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations)!;
  }

  static const LocalizationsDelegate<AppLocalizations> delegate =
      _AppLocalizationsDelegate();

  /// All supported locales.
  static const List<Locale> supportedLocales = <Locale>[
    Locale('en'),
    Locale('hi'),
    Locale('ta'),
    Locale('te'),
    Locale('mr'),
    Locale('bn'),
    Locale('gu'),
    Locale('kn'),
    Locale('ar'),
  ];

  static final Map<String, Map<String, String>> _localizedValues =
      <String, Map<String, String>>{
    'en': _en,
    'hi': _hi,
    'ta': _ta,
    'te': _te,
    'mr': _mr,
    'bn': _bn,
    'gu': _gu,
    'kn': _kn,
    'ar': _ar,
  };

  String get appTitle => _t('appTitle');
  String get home => _t('home');
  String get attendance => _t('attendance');
  String get students => _t('students');
  String get institutions => _t('institutions');
  String get notifications => _t('notifications');
  String get reports => _t('reports');
  String get assessments => _t('assessments');
  String get examinations => _t('examinations');
  String get scholarships => _t('scholarships');
  String get healthRecords => _t('healthRecords');
  String get profile => _t('profile');
  String get settings => _t('settings');
  String get login => _t('login');
  String get logout => _t('logout');
  String get loading => _t('loading');
  String get retry => _t('retry');
  String get error => _t('error');
  String get noData => _t('noData');
  String get save => _t('save');
  String get cancel => _t('cancel');
  String get submit => _t('submit');
  String get language => _t('language');
  String get theme => _t('theme');
  String get lightTheme => _t('lightTheme');
  String get darkTheme => _t('darkTheme');
  String get systemTheme => _t('systemTheme');
  String get notificationPreferences => _t('notificationPreferences');
  String get offline => _t('offline');
  String get syncing => _t('syncing');
  String get syncComplete => _t('syncComplete');
  String get conflictDetected => _t('conflictDetected');
  String get keepLocal => _t('keepLocal');
  String get keepServer => _t('keepServer');
  String get upcoming => _t('upcoming');
  String get results => _t('results');
  String get apply => _t('apply');
  String get status => _t('status');
  String get pending => _t('pending');
  String get approved => _t('approved');
  String get rejected => _t('rejected');

  String _t(String key) {
    final Map<String, String>? values = _localizedValues[locale.languageCode];
    return values?[key] ?? _en[key] ?? key;
  }

  // --- English ---
  static const Map<String, String> _en = <String, String>{
    'appTitle': 'ProctiraERP',
    'home': 'Home',
    'attendance': 'Attendance',
    'students': 'Students',
    'institutions': 'Institutions',
    'notifications': 'Notifications',
    'reports': 'Reports',
    'assessments': 'Assessments',
    'examinations': 'Examinations',
    'scholarships': 'Scholarships',
    'healthRecords': 'Health Records',
    'profile': 'Profile',
    'settings': 'Settings',
    'login': 'Login',
    'logout': 'Logout',
    'loading': 'Loading…',
    'retry': 'Retry',
    'error': 'Something went wrong',
    'noData': 'No data available',
    'save': 'Save',
    'cancel': 'Cancel',
    'submit': 'Submit',
    'language': 'Language',
    'theme': 'Theme',
    'lightTheme': 'Light',
    'darkTheme': 'Dark',
    'systemTheme': 'System',
    'notificationPreferences': 'Notification Preferences',
    'offline': 'Offline',
    'syncing': 'Syncing…',
    'syncComplete': 'Sync complete',
    'conflictDetected': 'Conflict detected',
    'keepLocal': 'Keep local',
    'keepServer': 'Keep server',
    'upcoming': 'Upcoming',
    'results': 'Results',
    'apply': 'Apply',
    'status': 'Status',
    'pending': 'Pending',
    'approved': 'Approved',
    'rejected': 'Rejected',
  };

  // --- Hindi ---
  static const Map<String, String> _hi = <String, String>{
    'appTitle': 'ProctiraERP',
    'home': 'होम',
    'attendance': 'उपस्थिति',
    'students': 'छात्र',
    'institutions': 'संस्थान',
    'notifications': 'सूचनाएं',
    'reports': 'रिपोर्ट',
    'assessments': 'मूल्यांकन',
    'examinations': 'परीक्षा',
    'scholarships': 'छात्रवृत्ति',
    'healthRecords': 'स्वास्थ्य रिकॉर्ड',
    'profile': 'प्रोफ़ाइल',
    'settings': 'सेटिंग्स',
    'login': 'लॉगिन',
    'logout': 'लॉगआउट',
    'loading': 'लोड हो रहा है…',
    'retry': 'पुनः प्रयास',
    'error': 'कुछ गलत हो गया',
    'noData': 'कोई डेटा उपलब्ध नहीं',
    'save': 'सहेजें',
    'cancel': 'रद्द करें',
    'submit': 'जमा करें',
    'language': 'भाषा',
    'theme': 'थीम',
    'lightTheme': 'लाइट',
    'darkTheme': 'डार्क',
    'systemTheme': 'सिस्टम',
    'notificationPreferences': 'सूचना प्राथमिकताएं',
    'offline': 'ऑफ़लाइन',
    'syncing': 'सिंक हो रहा है…',
    'syncComplete': 'सिंक पूर्ण',
    'conflictDetected': 'विरोध पाया गया',
    'keepLocal': 'स्थानीय रखें',
    'keepServer': 'सर्वर रखें',
    'upcoming': 'आगामी',
    'results': 'परिणाम',
    'apply': 'आवेदन करें',
    'status': 'स्थिति',
    'pending': 'लंबित',
    'approved': 'स्वीकृत',
    'rejected': 'अस्वीकृत',
  };

  // --- Tamil ---
  static const Map<String, String> _ta = <String, String>{
    'appTitle': 'ProctiraERP',
    'home': 'முகப்பு',
    'attendance': 'வருகை',
    'students': 'மாணவர்கள்',
    'institutions': 'நிறுவனங்கள்',
    'notifications': 'அறிவிப்புகள்',
    'reports': 'அறிக்கைகள்',
    'assessments': 'மதிப்பீடுகள்',
    'examinations': 'தேர்வுகள்',
    'scholarships': 'உதவித்தொகை',
    'healthRecords': 'சுகாதார பதிவுகள்',
    'profile': 'சுயவிவரம்',
    'settings': 'அமைப்புகள்',
    'login': 'உள்நுழைவு',
    'logout': 'வெளியேறு',
    'loading': 'ஏற்றுகிறது…',
    'retry': 'மீண்டும் முயற்சி',
    'error': 'ஏதோ தவறு நடந்தது',
    'noData': 'தரவு இல்லை',
    'save': 'சேமி',
    'cancel': 'ரத்து',
    'submit': 'சமர்ப்பி',
    'language': 'மொழி',
    'theme': 'தீம்',
    'lightTheme': 'ஒளி',
    'darkTheme': 'இருள்',
    'systemTheme': 'கணினி',
    'notificationPreferences': 'அறிவிப்பு விருப்பங்கள்',
    'offline': 'ஆஃப்லைன்',
    'syncing': 'ஒத்திசைக்கிறது…',
    'syncComplete': 'ஒத்திசைவு முடிந்தது',
    'conflictDetected': 'முரண்பாடு கண்டறியப்பட்டது',
    'keepLocal': 'உள்ளூர் வைத்திரு',
    'keepServer': 'சர்வர் வைத்திரு',
    'upcoming': 'வரவிருக்கும்',
    'results': 'முடிவுகள்',
    'apply': 'விண்ணப்பி',
    'status': 'நிலை',
    'pending': 'நிலுவையில்',
    'approved': 'ஒப்புதல்',
    'rejected': 'நிராகரிக்கப்பட்டது',
  };

  // --- Telugu ---
  static const Map<String, String> _te = <String, String>{
    'appTitle': 'ProctiraERP',
    'home': 'హోమ్',
    'attendance': 'హాజరు',
    'students': 'విద్యార్థులు',
    'institutions': 'సంస్థలు',
    'notifications': 'నోటిఫికేషన్లు',
    'reports': 'నివేదికలు',
    'assessments': 'అంచనాలు',
    'examinations': 'పరీక్షలు',
    'scholarships': 'స్కాలర్‌షిప్‌లు',
    'healthRecords': 'ఆరోగ్య రికార్డులు',
    'profile': 'ప్రొఫైల్',
    'settings': 'సెట్టింగ్‌లు',
    'login': 'లాగిన్',
    'logout': 'లాగౌట్',
    'loading': 'లోడ్ అవుతోంది…',
    'retry': 'మళ్ళీ ప్రయత్నించు',
    'error': 'ఏదో తప్పు జరిగింది',
    'noData': 'డేటా అందుబాటులో లేదు',
    'save': 'సేవ్',
    'cancel': 'రద్దు',
    'submit': 'సమర్పించు',
    'language': 'భాష',
    'theme': 'థీమ్',
    'lightTheme': 'లైట్',
    'darkTheme': 'డార్క్',
    'systemTheme': 'సిస్టమ్',
    'notificationPreferences': 'నోటిఫికేషన్ ప్రాధాన్యతలు',
    'offline': 'ఆఫ్‌లైన్',
    'syncing': 'సింక్ అవుతోంది…',
    'syncComplete': 'సింక్ పూర్తయింది',
    'conflictDetected': 'వైరుధ్యం గుర్తించబడింది',
    'keepLocal': 'స్థానికం ఉంచు',
    'keepServer': 'సర్వర్ ఉంచు',
    'upcoming': 'రాబోయే',
    'results': 'ఫలితాలు',
    'apply': 'దరఖాస్తు',
    'status': 'స్థితి',
    'pending': 'పెండింగ్',
    'approved': 'ఆమోదించబడింది',
    'rejected': 'తిరస్కరించబడింది',
  };

  // --- Marathi ---
  static const Map<String, String> _mr = <String, String>{
    'appTitle': 'ProctiraERP',
    'home': 'मुख्यपृष्ठ',
    'attendance': 'उपस्थिती',
    'students': 'विद्यार्थी',
    'institutions': 'संस्था',
    'notifications': 'सूचना',
    'reports': 'अहवाल',
    'assessments': 'मूल्यमापन',
    'examinations': 'परीक्षा',
    'scholarships': 'शिष्यवृत्ती',
    'healthRecords': 'आरोग्य नोंदी',
    'profile': 'प्रोफाइल',
    'settings': 'सेटिंग्ज',
    'login': 'लॉगिन',
    'logout': 'लॉगआउट',
    'loading': 'लोड होत आहे…',
    'retry': 'पुन्हा प्रयत्न करा',
    'error': 'काहीतरी चूक झाली',
    'noData': 'डेटा उपलब्ध नाही',
    'save': 'जतन करा',
    'cancel': 'रद्द करा',
    'submit': 'सबमिट करा',
    'language': 'भाषा',
    'theme': 'थीम',
    'lightTheme': 'लाइट',
    'darkTheme': 'डार्क',
    'systemTheme': 'सिस्टम',
    'notificationPreferences': 'सूचना प्राधान्ये',
    'offline': 'ऑफलाइन',
    'syncing': 'सिंक होत आहे…',
    'syncComplete': 'सिंक पूर्ण',
    'conflictDetected': 'विरोध आढळला',
    'keepLocal': 'स्थानिक ठेवा',
    'keepServer': 'सर्व्हर ठेवा',
    'upcoming': 'आगामी',
    'results': 'निकाल',
    'apply': 'अर्ज करा',
    'status': 'स्थिती',
    'pending': 'प्रलंबित',
    'approved': 'मंजूर',
    'rejected': 'नाकारले',
  };

  // --- Bengali ---
  static const Map<String, String> _bn = <String, String>{
    'appTitle': 'ProctiraERP',
    'home': 'হোম',
    'attendance': 'উপস্থিতি',
    'students': 'শিক্ষার্থী',
    'institutions': 'প্রতিষ্ঠান',
    'notifications': 'বিজ্ঞপ্তি',
    'reports': 'প্রতিবেদন',
    'assessments': 'মূল্যায়ন',
    'examinations': 'পরীক্ষা',
    'scholarships': 'বৃত্তি',
    'healthRecords': 'স্বাস্থ্য রেকর্ড',
    'profile': 'প্রোফাইল',
    'settings': 'সেটিংস',
    'login': 'লগইন',
    'logout': 'লগআউট',
    'loading': 'লোড হচ্ছে…',
    'retry': 'পুনরায় চেষ্টা',
    'error': 'কিছু ভুল হয়েছে',
    'noData': 'কোনো তথ্য নেই',
    'save': 'সংরক্ষণ',
    'cancel': 'বাতিল',
    'submit': 'জমা দিন',
    'language': 'ভাষা',
    'theme': 'থিম',
    'lightTheme': 'লাইট',
    'darkTheme': 'ডার্ক',
    'systemTheme': 'সিস্টেম',
    'notificationPreferences': 'বিজ্ঞপ্তি পছন্দ',
    'offline': 'অফলাইন',
    'syncing': 'সিঙ্ক হচ্ছে…',
    'syncComplete': 'সিঙ্ক সম্পন্ন',
    'conflictDetected': 'দ্বন্দ্ব সনাক্ত',
    'keepLocal': 'স্থানীয় রাখুন',
    'keepServer': 'সার্ভার রাখুন',
    'upcoming': 'আসন্ন',
    'results': 'ফলাফল',
    'apply': 'আবেদন',
    'status': 'অবস্থা',
    'pending': 'মুলতুবি',
    'approved': 'অনুমোদিত',
    'rejected': 'প্রত্যাখ্যাত',
  };

  // --- Gujarati ---
  static const Map<String, String> _gu = <String, String>{
    'appTitle': 'ProctiraERP',
    'home': 'હોમ',
    'attendance': 'હાજરી',
    'students': 'વિદ્યાર્થીઓ',
    'institutions': 'સંસ્થાઓ',
    'notifications': 'સૂચનાઓ',
    'reports': 'અહેવાલ',
    'assessments': 'મૂલ્યાંકન',
    'examinations': 'પરીક્ષા',
    'scholarships': 'શિષ્યવૃત્તિ',
    'healthRecords': 'આરોગ્ય રેકોર્ડ',
    'profile': 'પ્રોફાઇલ',
    'settings': 'સેટિંગ્સ',
    'login': 'લૉગિન',
    'logout': 'લૉગઆઉટ',
    'loading': 'લોડ થઈ રહ્યું છે…',
    'retry': 'ફરી પ્રયાસ',
    'error': 'કંઈક ખોટું થયું',
    'noData': 'કોઈ ડેટા ઉપલબ્ધ નથી',
    'save': 'સાચવો',
    'cancel': 'રદ કરો',
    'submit': 'સબમિટ',
    'language': 'ભાષા',
    'theme': 'થીમ',
    'lightTheme': 'લાઇટ',
    'darkTheme': 'ડાર્ક',
    'systemTheme': 'સિસ્ટમ',
    'notificationPreferences': 'સૂચના પસંદગીઓ',
    'offline': 'ઑફલાઇન',
    'syncing': 'સિંક થઈ રહ્યું છે…',
    'syncComplete': 'સિંક પૂર્ણ',
    'conflictDetected': 'વિરોધ મળ્યો',
    'keepLocal': 'સ્થાનિક રાખો',
    'keepServer': 'સર્વર રાખો',
    'upcoming': 'આગામી',
    'results': 'પરિણામ',
    'apply': 'અરજી',
    'status': 'સ્થિતિ',
    'pending': 'બાકી',
    'approved': 'મંજૂર',
    'rejected': 'નકારેલ',
  };

  // --- Kannada ---
  static const Map<String, String> _kn = <String, String>{
    'appTitle': 'ProctiraERP',
    'home': 'ಮುಖಪುಟ',
    'attendance': 'ಹಾಜರಾತಿ',
    'students': 'ವಿದ್ಯಾರ್ಥಿಗಳು',
    'institutions': 'ಸಂಸ್ಥೆಗಳು',
    'notifications': 'ಅಧಿಸೂಚನೆಗಳು',
    'reports': 'ವರದಿಗಳು',
    'assessments': 'ಮೌಲ್ಯಮಾಪನ',
    'examinations': 'ಪರೀಕ್ಷೆಗಳು',
    'scholarships': 'ವಿದ್ಯಾರ್ಥಿವೇತನ',
    'healthRecords': 'ಆರೋಗ್ಯ ದಾಖಲೆಗಳು',
    'profile': 'ಪ್ರೊಫೈಲ್',
    'settings': 'ಸೆಟ್ಟಿಂಗ್‌ಗಳು',
    'login': 'ಲಾಗಿನ್',
    'logout': 'ಲಾಗೌಟ್',
    'loading': 'ಲೋಡ್ ಆಗುತ್ತಿದೆ…',
    'retry': 'ಮರುಪ್ರಯತ್ನ',
    'error': 'ಏನೋ ತಪ್ಪಾಗಿದೆ',
    'noData': 'ಡೇಟಾ ಲಭ್ಯವಿಲ್ಲ',
    'save': 'ಉಳಿಸಿ',
    'cancel': 'ರದ್ದು',
    'submit': 'ಸಲ್ಲಿಸಿ',
    'language': 'ಭಾಷೆ',
    'theme': 'ಥೀಮ್',
    'lightTheme': 'ಲೈಟ್',
    'darkTheme': 'ಡಾರ್ಕ್',
    'systemTheme': 'ಸಿಸ್ಟಮ್',
    'notificationPreferences': 'ಅಧಿಸೂಚನೆ ಆದ್ಯತೆಗಳು',
    'offline': 'ಆಫ್‌ಲೈನ್',
    'syncing': 'ಸಿಂಕ್ ಆಗುತ್ತಿದೆ…',
    'syncComplete': 'ಸಿಂಕ್ ಪೂರ್ಣ',
    'conflictDetected': 'ಸಂಘರ್ಷ ಪತ್ತೆಯಾಗಿದೆ',
    'keepLocal': 'ಸ್ಥಳೀಯ ಇಡಿ',
    'keepServer': 'ಸರ್ವರ್ ಇಡಿ',
    'upcoming': 'ಮುಂಬರುವ',
    'results': 'ಫಲಿತಾಂಶ',
    'apply': 'ಅರ್ಜಿ',
    'status': 'ಸ್ಥಿತಿ',
    'pending': 'ಬಾಕಿ',
    'approved': 'ಅನುಮೋದಿಸಲಾಗಿದೆ',
    'rejected': 'ತಿರಸ್ಕರಿಸಲಾಗಿದೆ',
  };

  // --- Arabic ---
  static const Map<String, String> _ar = <String, String>{
    'appTitle': 'ProctiraERP',
    'home': 'الرئيسية',
    'attendance': 'الحضور',
    'students': 'الطلاب',
    'institutions': 'المؤسسات',
    'notifications': 'الإشعارات',
    'reports': 'التقارير',
    'assessments': 'التقييمات',
    'examinations': 'الامتحانات',
    'scholarships': 'المنح الدراسية',
    'healthRecords': 'السجلات الصحية',
    'profile': 'الملف الشخصي',
    'settings': 'الإعدادات',
    'login': 'تسجيل الدخول',
    'logout': 'تسجيل الخروج',
    'loading': 'جاري التحميل…',
    'retry': 'إعادة المحاولة',
    'error': 'حدث خطأ ما',
    'noData': 'لا توجد بيانات',
    'save': 'حفظ',
    'cancel': 'إلغاء',
    'submit': 'إرسال',
    'language': 'اللغة',
    'theme': 'المظهر',
    'lightTheme': 'فاتح',
    'darkTheme': 'داكن',
    'systemTheme': 'النظام',
    'notificationPreferences': 'تفضيلات الإشعارات',
    'offline': 'غير متصل',
    'syncing': 'جاري المزامنة…',
    'syncComplete': 'اكتملت المزامنة',
    'conflictDetected': 'تم اكتشاف تعارض',
    'keepLocal': 'الاحتفاظ بالمحلي',
    'keepServer': 'الاحتفاظ بالخادم',
    'upcoming': 'القادمة',
    'results': 'النتائج',
    'apply': 'تقديم',
    'status': 'الحالة',
    'pending': 'قيد الانتظار',
    'approved': 'مقبول',
    'rejected': 'مرفوض',
  };
}

class _AppLocalizationsDelegate
    extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  bool isSupported(Locale locale) {
    return AppLocalizations.supportedLocales
        .any((Locale l) => l.languageCode == locale.languageCode);
  }

  @override
  Future<AppLocalizations> load(Locale locale) {
    return SynchronousFuture<AppLocalizations>(AppLocalizations(locale));
  }

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}
