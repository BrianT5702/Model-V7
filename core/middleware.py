"""Middleware to expose the current request user for project activity tracking."""

from .project_activity import clear_request_user, set_request_user


class ProjectActivityMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        set_request_user(getattr(request, 'user', None))
        try:
            return self.get_response(request)
        finally:
            clear_request_user()
