import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Application theme configuration with Material 3 support.
///
/// ProctiraERP Design System v2.0 — indigo brand, slate neutrals, deep-navy
/// chrome. Mirrors `redesign/shared/tokens.css`. Light and dark themes can
/// optionally be seeded from tenant brand colors; the v2.0 indigo/teal
/// palette is the default.
class AppTheme {
  AppTheme._();

  // ProctiraERP Design System v2.0 brand palette.
  static const Color _defaultPrimary = Color(0xFF4F46E5); // brand-600
  static const Color _defaultSecondary = Color(0xFF14B8A6); // teal-500

  // Surfaces (light).
  static const Color _lightBackground = Color(0xFFF8FAFC); // slate-50
  static const Color _lightSurface = Color(0xFFFFFFFF);
  static const Color _lightBorder = Color(0xFFE2E8F0); // slate-200

  // Surfaces (dark) — deep navy, matching the web dark theme.
  static const Color _darkBackground = Color(0xFF0B1120);
  static const Color _darkSurface = Color(0xFF111A2E);
  static const Color _darkBorder = Color(0xFF233252);

  /// Build a light theme, optionally seeded from tenant brand colors.
  static ThemeData light({
    Color? primaryColor,
    Color? secondaryColor,
  }) {
    final Color primary = primaryColor ?? _defaultPrimary;
    final Color secondary = secondaryColor ?? _defaultSecondary;

    final ColorScheme colorScheme = ColorScheme.fromSeed(
      seedColor: primary,
      primary: primary,
      secondary: secondary,
      surface: _lightSurface,
      brightness: Brightness.light,
    );

    return _buildTheme(colorScheme);
  }

  /// Build a dark theme, optionally seeded from tenant brand colors.
  static ThemeData dark({
    Color? primaryColor,
    Color? secondaryColor,
  }) {
    final Color primary = primaryColor ?? const Color(0xFF818CF8); // brand-400
    final Color secondary = secondaryColor ?? _defaultSecondary;

    final ColorScheme colorScheme = ColorScheme.fromSeed(
      seedColor: primary,
      primary: primary,
      secondary: secondary,
      surface: _darkSurface,
      brightness: Brightness.dark,
    );

    return _buildTheme(colorScheme);
  }

  static ThemeData _buildTheme(ColorScheme colorScheme) {
    final bool isDark = colorScheme.brightness == Brightness.dark;
    final Color border = isDark ? _darkBorder : _lightBorder;
    final TextTheme baseText = isDark
        ? ThemeData.dark().textTheme
        : ThemeData.light().textTheme;

    return ThemeData(
      useMaterial3: true,
      colorScheme: colorScheme,
      scaffoldBackgroundColor: isDark ? _darkBackground : _lightBackground,
      textTheme: GoogleFonts.interTextTheme(baseText).copyWith(
        // Display/headline weights per Design System v2.0 type scale.
        headlineSmall: GoogleFonts.inter(
          fontSize: 22,
          fontWeight: FontWeight.w800,
          letterSpacing: -0.4,
          color: isDark ? const Color(0xFFE6EBF5) : const Color(0xFF0F172A),
        ),
        titleMedium: GoogleFonts.inter(
          fontSize: 16,
          fontWeight: FontWeight.w700,
          letterSpacing: -0.2,
        ),
      ),
      // Light app bar over the page surface (v2.0): content-first chrome
      // instead of a solid primary-colored band.
      appBarTheme: AppBarTheme(
        backgroundColor: isDark ? _darkBackground : _lightBackground,
        foregroundColor: colorScheme.onSurface,
        elevation: 0,
        scrolledUnderElevation: 0.5,
        centerTitle: false,
        titleTextStyle: GoogleFonts.inter(
          fontSize: 19,
          fontWeight: FontWeight.w800,
          letterSpacing: -0.3,
          color: isDark ? const Color(0xFFE6EBF5) : const Color(0xFF0F172A),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: colorScheme.primary,
          foregroundColor: colorScheme.onPrimary,
          minimumSize: const Size.fromHeight(52),
          textStyle: GoogleFonts.inter(
            fontSize: 15,
            fontWeight: FontWeight.w700,
          ),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size.fromHeight(52),
          side: BorderSide(color: border),
          textStyle: GoogleFonts.inter(
            fontSize: 15,
            fontWeight: FontWeight.w700,
          ),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          minimumSize: const Size(48, 48),
          textStyle: GoogleFonts.inter(
            fontSize: 14,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: isDark ? _darkSurface : Colors.white,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide(color: border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide(color: border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide(color: colorScheme.primary, width: 2),
        ),
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      ),
      cardTheme: CardThemeData(
        elevation: 0,
        color: isDark ? _darkSurface : _lightSurface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(18),
          side: BorderSide(color: border),
        ),
        clipBehavior: Clip.antiAlias,
      ),
      chipTheme: ChipThemeData(
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(999),
        ),
        side: BorderSide(color: border),
        labelStyle: GoogleFonts.inter(
          fontSize: 12,
          fontWeight: FontWeight.w600,
        ),
      ),
      dividerTheme: DividerThemeData(space: 1, color: border),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: isDark ? _darkSurface : _lightSurface,
        indicatorColor: colorScheme.primary.withValues(alpha: 0.14),
        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
        labelTextStyle: WidgetStatePropertyAll(
          GoogleFonts.inter(fontSize: 11, fontWeight: FontWeight.w600),
        ),
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
        ),
      ),
      floatingActionButtonTheme: FloatingActionButtonThemeData(
        backgroundColor: colorScheme.primary,
        foregroundColor: colorScheme.onPrimary,
        elevation: 3,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(19),
        ),
      ),
    );
  }
}
