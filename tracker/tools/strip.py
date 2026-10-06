# -*- coding: utf-8 -*-
"""Wycinanie komentarzy z JS i CSS, świadome stringów i wyrażeń regularnych.
Naiwny regex zepsułby 'http://...' w kodzie i '/*' wewnątrz stringa."""


def strip_js(src):
    out = []
    i, n = 0, len(src)
    # prev_sig: ostatni znaczący znak — decyduje, czy '/' zaczyna regex czy dzielenie
    prev_sig = ''
    while i < n:
        c = src[i]
        if c in '"\'`':
            q = c
            j = i + 1
            while j < n:
                if src[j] == '\\':
                    j += 2
                    continue
                if src[j] == q:
                    break
                j += 1
            out.append(src[i:j + 1])
            prev_sig = q
            i = j + 1
            continue
        if c == '/' and i + 1 < n:
            nxt = src[i + 1]
            if nxt == '/':
                j = src.find('\n', i)
                i = n if j < 0 else j
                continue
            if nxt == '*':
                j = src.find('*/', i + 2)
                i = n if j < 0 else j + 2
                continue
            # regex tylko tam, gdzie wyrażenie może się zacząć
            if prev_sig in '' or prev_sig in '(,=:[!&|?{};+-*%<>~^' or prev_sig == '':
                j = i + 1
                in_class = False
                while j < n:
                    if src[j] == '\\':
                        j += 2
                        continue
                    if src[j] == '[':
                        in_class = True
                    elif src[j] == ']':
                        in_class = False
                    elif src[j] == '/' and not in_class:
                        break
                    elif src[j] == '\n':
                        break
                    j += 1
                out.append(src[i:j + 1])
                prev_sig = '/'
                i = j + 1
                continue
        out.append(c)
        if not c.isspace():
            prev_sig = c
        i += 1
    text = ''.join(out)
    lines = [ln.rstrip() for ln in text.split('\n')]
    lines = [ln.lstrip() if ln.strip() else '' for ln in lines]
    return '\n'.join(ln for ln in lines if ln)


def strip_css(src):
    out = []
    i, n = 0, len(src)
    while i < n:
        if src.startswith('/*', i):
            j = src.find('*/', i + 2)
            i = n if j < 0 else j + 2
            continue
        if src[i] in '"\'':
            q = src[i]
            j = i + 1
            while j < n:
                if src[j] == '\\':
                    j += 2
                    continue
                if src[j] == q:
                    break
                j += 1
            out.append(src[i:j + 1])
            i = j + 1
            continue
        out.append(src[i])
        i += 1
    text = ''.join(out)
    lines = [ln.strip() for ln in text.split('\n')]
    return '\n'.join(ln for ln in lines if ln)
