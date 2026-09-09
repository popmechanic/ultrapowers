def outer():
    def foo(a, b):
        return a + b

    return foo
