"""Errors shown to the user as they are (the API turns them into 400s)."""


class ProjectError(Exception):
    code = "error"
