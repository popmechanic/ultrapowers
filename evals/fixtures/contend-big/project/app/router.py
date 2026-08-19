"""Minimal HTTP-less request router.

A route is a (method, path) pair mapped to a handler callable. There is no
real HTTP layer here — `dispatch` is called directly with keyword arguments
that stand in for parsed path params / query params / body fields.
"""


class RouteNotFoundError(Exception):
    pass


class RouteAlreadyRegisteredError(Exception):
    pass


class Router:
    def __init__(self):
        self._routes = {}

    def register(self, method, path, handler):
        key = (method.upper(), path)
        if key in self._routes:
            raise RouteAlreadyRegisteredError("%s %s" % key)
        self._routes[key] = handler
        return handler

    def dispatch(self, method, path, **kwargs):
        key = (method.upper(), path)
        handler = self._routes.get(key)
        if handler is None:
            raise RouteNotFoundError("%s %s" % key)
        return handler(**kwargs)

    def routes(self):
        """Sorted (method, path) pairs currently registered."""
        return sorted(self._routes.keys())
