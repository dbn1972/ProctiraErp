import 'package:proctira_api_client/proctira_api_client.dart';
import 'package:test/test.dart';

void main() {
  group('AuthLoginResult', () {
    test('parses gateway login payload', () {
      final AuthLoginResult result = AuthLoginResult.fromJson(
        <String, dynamic>{
          'tokens': <String, dynamic>{
            'accessToken': 'access-1',
            'refreshToken': 'refresh-1',
            'expiresIn': 900,
          },
          'user': <String, dynamic>{
            'userId': 'user-42',
            'email': 'teacher@school.edu',
            'displayName': 'Teacher',
          },
        },
      );

      expect(result.userId, 'user-42');
      expect(result.accessToken, 'access-1');
      expect(result.refreshToken, 'refresh-1');
      expect(result.email, 'teacher@school.edu');
      expect(result.expiresIn, 900);
    });

    test('throws when tokens missing', () {
      expect(
        () => AuthLoginResult.fromJson(<String, dynamic>{
          'user': <String, dynamic>{'userId': 'u1'},
        }),
        throwsA(isA<FormatException>()),
      );
    });
  });

  group('AuthTokenPair', () {
    test('parses refresh payload with tokens wrapper', () {
      final AuthTokenPair pair = AuthTokenPair.fromJson(
        <String, dynamic>{
          'tokens': <String, dynamic>{
            'accessToken': 'a2',
            'refreshToken': 'r2',
          },
        },
      );
      expect(pair.accessToken, 'a2');
      expect(pair.refreshToken, 'r2');
    });
  });
}
