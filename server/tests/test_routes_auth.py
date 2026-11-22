"""Route tests for health and auth: signup, login, logout and /api/auth/me."""

from routes_support import DEMO_EMAIL, DEMO_PASSWORD, NEW_PASSWORD, SESSION_COOKIE, RouteTestCase, unique_email


class HealthRouteTests(RouteTestCase):
    def test_health_200(self):
        resp = self.client.get("/api/health")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), {"ok": True})


class SignupRouteTests(RouteTestCase):
    def test_auth_signup_422_schema(self):
        resp = self.client.post("/api/auth/signup", json={
            "name": "Dr X", "clinicName": "Clinic", "email": unique_email(), "password": "123",
        })
        self.assertEqual(resp.status_code, 422)

    def test_auth_signup_409_duplicate(self):
        email = unique_email()
        self.signup(email=email)
        resp = self.client.post("/api/auth/signup", json={
            "name": "Dr Y", "clinicName": "Clinic", "email": email.upper(), "password": NEW_PASSWORD,
        })
        self.assertEqual(resp.status_code, 409)

    def test_auth_signup_201_defaults(self):
        email = unique_email()
        resp = self.client.post("/api/auth/signup", json={
            "name": "Dr Z", "clinicName": "Clinic", "email": email.upper(), "password": NEW_PASSWORD,
        })
        self.assertEqual(resp.status_code, 201, resp.text)
        user = resp.json()["user"]
        self.assertEqual(user["bankBalance"], 0)
        self.assertEqual(user["upiId"], "physiocare@okaxis")
        self.assertEqual(user["email"], email)
        self.assertIn(SESSION_COOKIE, self.client.cookies)


class LoginRouteTests(RouteTestCase):
    def test_auth_login_422_schema(self):
        resp = self.client.post("/api/auth/login", json={"email": DEMO_EMAIL})
        self.assertEqual(resp.status_code, 422)

    def test_auth_login_401_unknown_email(self):
        resp = self.client.post("/api/auth/login", json={"email": "nobody@example.com", "password": "whatever"})
        self.assertEqual(resp.status_code, 401)

    def test_auth_login_401_bad_password(self):
        resp = self.client.post("/api/auth/login", json={"email": DEMO_EMAIL, "password": "wrong-pass"})
        self.assertEqual(resp.status_code, 401)

    def test_auth_login_200_sets_session_cookie(self):
        resp = self.client.post("/api/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD})
        self.assertEqual(resp.status_code, 200, resp.text)
        self.assertEqual(resp.json()["user"]["email"], DEMO_EMAIL)
        self.assertIn("set-cookie", resp.headers)
        self.assertIn(SESSION_COOKIE, self.client.cookies)


class LogoutRouteTests(RouteTestCase):
    def test_auth_logout_204_ends_session(self):
        self.login_demo()
        self.assertEqual(self.client.get("/api/auth/me").status_code, 200)
        resp = self.client.post("/api/auth/logout")
        self.assertEqual(resp.status_code, 204)
        self.assertEqual(self.client.get("/api/auth/me").status_code, 401)


class MeRouteTests(RouteTestCase):
    def test_auth_me_401_when_signed_out(self):
        resp = self.client.get("/api/auth/me")
        self.assertEqual(resp.status_code, 401)
        self.assertEqual(resp.json()["detail"], "Not signed in.")

    def test_auth_me_200_when_signed_in(self):
        self.login_demo()
        resp = self.client.get("/api/auth/me")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["user"]["email"], DEMO_EMAIL)
