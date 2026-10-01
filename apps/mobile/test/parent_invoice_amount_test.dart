import 'package:flutter_test/flutter_test.dart';
import 'package:proctira_mobile/features/parent_portal/data/parent_portal_models.dart';

ParentInvoice _invoice(int? cents, String currency) => ParentInvoice(
  id: 'i-1',
  studentId: 'stu-1',
  title: 'Term fees',
  status: 'issued',
  amountCents: cents,
  currency: currency,
);

/// PRC-L012: currency symbol + locale grouping; missing amount is flagged.
void main() {
  test('INR uses rupee symbol and Indian grouping', () {
    expect(_invoice(12345000, 'INR').amountLabel, '₹1,23,450.00');
  });

  test('other currencies use their symbol', () {
    expect(_invoice(150050, 'USD').amountLabel, r'$1,500.50');
  });

  test('negative amounts keep their sign', () {
    expect(_invoice(-2500, 'INR').amountLabel, contains('-'));
  });

  test('missing amount surfaces as unavailable, not zero', () {
    final ParentInvoice invoice = _invoice(null, 'INR');
    expect(invoice.hasValidAmount, isFalse);
    expect(invoice.amountLabel, 'Amount unavailable');
    expect(invoice.amountLabel, isNot(contains('0.00')));
  });

  test('blank currency still formats the number', () {
    expect(_invoice(150050, '').amountLabel, '1,500.50');
  });
}
