import sys
from types import ModuleType, SimpleNamespace
from urllib.parse import quote


def install_requests_stub() -> None:
    if "requests" in sys.modules:
        return

    requests = ModuleType("requests")

    class Response:
        status_code = 200
        text = ""

        def raise_for_status(self) -> None:
            pass

        def json(self) -> dict:
            return {}

    class RequestException(Exception):
        pass

    class HTTPError(RequestException):
        def __init__(self, *args: object, response: Response | None = None) -> None:
            super().__init__(*args)
            self.response = response

    def request(*_args: object, **_kwargs: object) -> Response:
        raise AssertionError("requests.request must be mocked in tests")

    def get(*_args: object, **_kwargs: object) -> Response:
        raise AssertionError("requests.get must be mocked in tests")

    def post(*_args: object, **_kwargs: object) -> Response:
        raise AssertionError("requests.post must be mocked in tests")

    requests.Response = Response
    requests.RequestException = RequestException
    requests.HTTPError = HTTPError
    requests.request = request
    requests.get = get
    requests.post = post
    requests.utils = SimpleNamespace(quote=quote)

    sys.modules["requests"] = requests
