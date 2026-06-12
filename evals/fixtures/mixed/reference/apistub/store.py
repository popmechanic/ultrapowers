from apistub.schema import User


class MemoryStore:
    def __init__(self):
        self._users = []
        self._next_id = 1

    def add(self, name, email):
        user = User(id=self._next_id, name=name, email=email)
        self._next_id += 1
        self._users.append(user)
        return user

    def get(self, user_id):
        for user in self._users:
            if user.id == user_id:
                return user
        return None

    def list(self):
        return list(self._users)
