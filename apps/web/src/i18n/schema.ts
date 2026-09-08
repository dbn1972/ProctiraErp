/**
 * Canonical i18n message schema for the ProctiraERP web application.
 *
 * This file defines the TypeScript type representing the complete key tree
 * that every locale catalog (en.json, hi.json, ta.json, etc.) must implement.
 * The `pnpm check:i18n` script validates key parity at CI time; this type
 * provides compile-time safety when accessing translation keys in components.
 *
 * When adding new keys:
 *   1. Add the key to this schema type.
 *   2. Add the English value to `apps/web/src/messages/en.json`.
 *   3. Run `pnpm check:i18n` — it will fail until all catalogs are updated.
 *
 * ICU placeholders are documented inline with `{placeholder}` notation.
 */

export interface MessageSchema {
  common: {
    appName: string;
    loading: string;
    error: string;
    retry: string;
    save: string;
    cancel: string;
    delete: string;
    edit: string;
    create: string;
    search: string;
    filter: string;
    export: string;
    import: string;
    back: string;
    next: string;
    previous: string;
  };
  nav: {
    dashboard: string;
    institutions: string;
    academicPeriods: string;
    students: string;
    staff: string;
    assessments: string;
    attendance: string;
    examinations: string;
    scholarships: string;
    health: string;
    workflows: string;
    dataWarehouse: string;
    reports: string;
    admin: string;
  };
  auth: {
    login: string;
    signIn: string;
    logout: string;
    email: string;
    emailAddress: string;
    password: string;
    newPassword: string;
    confirmPassword: string;
    rememberMe: string;
    showPassword: string;
    hidePassword: string;
    forgotPassword: string;
    welcomeBack: string;
    signInSubtitle: string;
    /** ICU: {brand} */
    signInToBrand: string;
    signingIn: string;
    emailRequired: string;
    emailInvalid: string;
    passwordRequired: string;
    invalidCredentials: string;
    networkError: string;
    sessionExpired: string;
    oauthFailed: string;
    orContinueWith: string;
    /** ICU: {provider} */
    continueWith: string;
    contactAdmin: string;
    resetYourPassword: string;
    resetPasswordSubtitle: string;
    enterRegisteredEmail: string;
    sendResetLink: string;
    sending: string;
    checkYourEmail: string;
    /** ICU: {email} */
    resetLinkSentTo: string;
    resendEmail: string;
    backToSignIn: string;
    passwordResetFailed: string;
    createNewPassword: string;
    createNewPasswordSubtitle: string;
    updatePassword: string;
    saving: string;
    resetTokenMissing: string;
    /** ICU: {min} */
    passwordTooShort: string;
    passwordsDoNotMatch: string;
    twoFactorAuthentication: string;
    mfaSubtitle: string;
    verificationCode: string;
    /** ICU: {number} */
    digitNumber: string;
    verify: string;
    verifying: string;
    didntReceiveCode: string;
    resend: string;
    mfaTokenMissing: string;
    mfaIncomplete: string;
    mfaInvalid: string;
    signUp: string;
    /** ICU: {brand} */
    signUpSubtitle: string;
    signUpHeading: string;
    creatingAccount: string;
    alreadyHaveAccount: string;
    signInLink: string;
    fullName: string;
    fullNamePlaceholder: string;
    fullNameRequired: string;
    institutionName: string;
    institutionNamePlaceholder: string;
    institutionNameRequired: string;
    yourRole: string;
    selectRole: string;
    roleRequired: string;
    rolesUnavailable: string;
    passwordRequirements: string;
    passwordStrength: string;
    passwordStrengthWeak: string;
    passwordStrengthFair: string;
    passwordStrengthGood: string;
    passwordStrengthStrong: string;
    passwordRuleLength: string;
    passwordRuleUppercase: string;
    passwordRuleLowercase: string;
    passwordRuleNumber: string;
    passwordRuleSymbol: string;
    passwordTooWeak: string;
    confirmPasswordRequired: string;
    /** ICU: {terms}, {privacy} */
    agreeToTerms: string;
    termsLinkLabel: string;
    privacyLinkLabel: string;
    termsRequired: string;
    orSignUpWith: string;
    signUpFailed: string;
    /** ICU: {email} */
    checkYourEmailToActivate: string;
    accountCreatedTitle: string;
    mfaSetupTitle: string;
    mfaSetupSubtitle: string;
    mfaSetupLoading: string;
    mfaSetupFailed: string;
    tryAgain: string;
    mfaScanHeading: string;
    mfaScanDescription: string;
    mfaQrAlt: string;
    mfaSecretLabel: string;
    mfaSecretHelp: string;
    mfaBackupCodesHeading: string;
    mfaBackupCodesDescription: string;
    mfaDownloadCodes: string;
    mfaPrintCodes: string;
    mfaAcknowledgement: string;
    mfaAcknowledgementHelp: string;
    mfaFinishSetup: string;
  };
  dashboard: {
    title: string;
    /** ICU: {name} */
    welcome: string;
    overview: string;
  };
  breadcrumbs: {
    home: string;
  };
  theme: {
    toggle: string;
  };
  marketing: {
    nav: {
      primaryLabel: string;
      features: string;
      pricing: string;
      about: string;
      contact: string;
      demo: string;
    };
    cta: {
      signIn: string;
      getStarted: string;
    };
    footer: {
      label: string;
      navigationLabel: string;
      /** ICU: {year}, {brand} */
      copyright: string;
      product: {
        title: string;
        features: string;
        pricing: string;
        demo: string;
        changelog: string;
      };
      solutions: {
        title: string;
        ministries: string;
        states: string;
        boards: string;
        schools: string;
      };
      developers: {
        title: string;
        documentation: string;
        apiReference: string;
        sdk: string;
        webhooks: string;
      };
      installation: {
        title: string;
        guide: string;
        selfHosted: string;
        cloud: string;
        requirements: string;
      };
      plugins: {
        title: string;
        marketplace: string;
        directory: string;
        build: string;
        submit: string;
      };
      resources: {
        title: string;
        blog: string;
        guides: string;
        caseStudies: string;
        help: string;
      };
      company: {
        title: string;
        about: string;
        careers: string;
        press: string;
        partners: string;
      };
      contact: {
        title: string;
        sales: string;
        support: string;
        offices: string;
        form: string;
      };
      legal: {
        title: string;
        terms: string;
        acceptableUse: string;
        dpa: string;
        subprocessors: string;
      };
      privacy: {
        title: string;
        policy: string;
        cookies: string;
        dataRights: string;
        children: string;
      };
      security: {
        title: string;
        overview: string;
        compliance: string;
        trust: string;
        report: string;
      };
      status: {
        title: string;
        system: string;
        incidents: string;
        uptime: string;
        subscribe: string;
      };
      language: {
        title: string;
        selectorLabel: string;
      };
    };
    pages: {
      landing: {
        documentTitle: string;
        heroBadge: string;
        heroHeading: string;
        heroSubheading: string;
        primaryCta: string;
        secondaryCta: string;
        trustBar: string;
        featuresHeading: string;
        featuresSubheading: string;
        feature1Title: string;
        feature1Body: string;
        feature2Title: string;
        feature2Body: string;
        feature3Title: string;
        feature3Body: string;
        feature4Title: string;
        feature4Body: string;
        feature5Title: string;
        feature5Body: string;
        feature6Title: string;
        feature6Body: string;
        ctaHeading: string;
        ctaBody: string;
        ctaPrimary: string;
        ctaSecondary: string;
      };
      about: {
        documentTitle: string;
        eyebrow: string;
        heading: string;
        lead: string;
        missionTitle: string;
        missionBody: string;
        visionTitle: string;
        visionBody: string;
        principlesHeading: string;
        principle1Title: string;
        principle1Body: string;
        principle2Title: string;
        principle2Body: string;
        principle3Title: string;
        principle3Body: string;
        principle4Title: string;
        principle4Body: string;
        statsHeading: string;
        stat1Value: string;
        stat1Label: string;
        stat2Value: string;
        stat2Label: string;
        stat3Value: string;
        stat3Label: string;
      };
      features: {
        documentTitle: string;
        eyebrow: string;
        heading: string;
        lead: string;
        categoriesHeading: string;
        category1Title: string;
        category1Body: string;
        category2Title: string;
        category2Body: string;
        category3Title: string;
        category3Body: string;
        category4Title: string;
        category4Body: string;
        category5Title: string;
        category5Body: string;
        category6Title: string;
        category6Body: string;
        highlightsHeading: string;
        highlight1: string;
        highlight2: string;
        highlight3: string;
        highlight4: string;
        highlight5: string;
        highlight6: string;
      };
      pricing: {
        documentTitle: string;
        eyebrow: string;
        heading: string;
        lead: string;
        communityTitle: string;
        communityPrice: string;
        communityCadence: string;
        communityCta: string;
        communityFeature1: string;
        communityFeature2: string;
        communityFeature3: string;
        communityFeature4: string;
        professionalTitle: string;
        professionalPrice: string;
        professionalCadence: string;
        professionalCta: string;
        professionalFeature1: string;
        professionalFeature2: string;
        professionalFeature3: string;
        professionalFeature4: string;
        enterpriseTitle: string;
        enterprisePrice: string;
        enterpriseCadence: string;
        enterpriseCta: string;
        enterpriseFeature1: string;
        enterpriseFeature2: string;
        enterpriseFeature3: string;
        enterpriseFeature4: string;
        footnote: string;
      };
      contact: {
        documentTitle: string;
        eyebrow: string;
        heading: string;
        lead: string;
        salesTitle: string;
        salesBody: string;
        salesEmail: string;
        supportTitle: string;
        supportBody: string;
        supportEmail: string;
        communityTitle: string;
        communityBody: string;
        communityEmail: string;
        officesHeading: string;
        officesBody: string;
        ctaHeading: string;
        ctaBody: string;
        ctaButton: string;
      };
      demo: {
        documentTitle: string;
        eyebrow: string;
        heading: string;
        lead: string;
        agendaHeading: string;
        agendaItem1: string;
        agendaItem2: string;
        agendaItem3: string;
        agendaItem4: string;
        agendaItem5: string;
        audienceHeading: string;
        audienceBody: string;
        preparationHeading: string;
        preparationItem1: string;
        preparationItem2: string;
        preparationItem3: string;
        ctaHeading: string;
        ctaBody: string;
        ctaButton: string;
      };
      legal: {
        privacyTitle: string;
        termsTitle: string;
        lastUpdatedLabel: string;
      };
    };
  };
  settings: {
    branding: {
      title: string;
      description: string;
      /** ICU: {revision} */
      currentRevision: string;
      previewToggle: string;
      previewEnabled: string;
      previewDisabled: string;
      saveDraft: string;
      publish: string;
      publishing: string;
      successTitle: string;
      errorTitle: string;
      draftSaved: string;
      draftSaveFailed: string;
      publishSuccess: string;
      publishFailed: string;
      publishValidationFailed: string;
      loadFailed: string;
      loadFailedTitle: string;
      /** ICU: {ratio}, {threshold} */
      contrastLabel: string;
      sections: {
        identity: string;
        colors: string;
        loginBackground: string;
      };
      fields: {
        logo: string;
        favicon: string;
        primary: string;
        accent: string;
        loginBg: string;
      };
      hints: {
        logo: string;
        favicon: string;
        primary: string;
        accent: string;
        loginBg: string;
      };
      placeholders: {
        logo: string;
        logoUpload: string;
        favicon: string;
        faviconUpload: string;
        loginBg: string;
      };
      preview: {
        label: string;
        title: string;
        signIn: string;
        appLabel: string;
        hint: string;
      };
      errors: {
        logoRequired: string;
        logoReadFailed: string;
        faviconRequired: string;
        faviconReadFailed: string;
        primaryContrast: string;
        accentContrast: string;
        loginBgRequired: string;
      };
    };
  };
  examinations: {
    title: string;
    newExamination: string;
    candidates: string;
    results: string;
    documents: string;
  };
  scholarships: {
    title: string;
    applications: string;
    disbursements: string;
  };
  health: {
    title: string;
    specialNeeds: string;
    counselling: string;
    accessDenied: string;
  };
  workflows: {
    title: string;
    instances: string;
    approvals: string;
  };
  dataWarehouse: {
    title: string;
    indicators: string;
    import: string;
    map: string;
  };
  reports: {
    title: string;
    newReport: string;
    results: string;
  };
  admin: {
    title: string;
    users: string;
    roles: string;
    permissions: string;
    tenant: string;
  };
  connectivity: {
    online: string;
    offline: string;
    syncing: string;
  };
  sync: {
    conflict: {
      title: string;
      /** ICU: {method}, {entity} */
      description: string;
      /** ICU: {count} (plural) */
      fieldsHeading: string;
      /** ICU: {field} */
      fieldsetLabel: string;
      /** ICU: {version} */
      serverVersion: string;
      keepLocal: string;
      useServer: string;
      payloadsToggle: string;
      localPayload: string;
      serverPayload: string;
      amend: string;
      discard: string;
    };
  };
  tracking: {
    title: string;
    subtitle: string;
    trackingNumberLabel: string;
    trackingNumberPlaceholder: string;
    checkStatus: string;
    checking: string;
    trackingNumberRequired: string;
    currentStatus: string;
    currentStep: string;
    submittedAt: string;
    lastUpdated: string;
    expectedCompletionAt: string;
    history: string;
    historyEmpty: string;
    followUp: string;
    followUpEmpty: string;
    notFoundTitle: string;
    notFound: string;
    errorTitle: string;
    errorMessage: string;
    retry: string;
    newSearch: string;
    statusPending: string;
    statusUnderReview: string;
    statusApproved: string;
    statusRejected: string;
    statusWaitlisted: string;
    /** ICU: {status} */
    statusUnknown: string;
  };
}

/**
 * The set of supported Indian Language Set locale codes.
 * Requirement 18 defines these as the primary supported languages.
 */
export const INDIAN_LANGUAGE_SET = ['en', 'hi', 'ta', 'te', 'mr', 'bn', 'gu', 'kn'] as const;

export type IndianLocale = (typeof INDIAN_LANGUAGE_SET)[number];

/**
 * Native display names for each locale in the Indian Language Set.
 * Used by the LanguageSelector component (Requirement 18 AC 7).
 */
export const LOCALE_NATIVE_NAMES: Record<IndianLocale, string> = {
  en: 'English',
  hi: 'हिन्दी',
  ta: 'தமிழ்',
  te: 'తెలుగు',
  mr: 'मराठी',
  bn: 'বাংলা',
  gu: 'ગુજરાતી',
  kn: 'ಕನ್ನಡ',
};
