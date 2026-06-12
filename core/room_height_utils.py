import re


def _to_mm(value):
    """Convert a numeric input to mm; values <= 50 are treated as metres."""
    number = float(value)
    if number <= 0:
        raise ValueError('Height must be greater than 0')
    if number <= 50:
        return number * 1000.0
    return number


def parse_height_input(raw):
    """
    Parse a room height string.
    Accepts: '3000', '5000-6000', '5 - 10' (metres), '5m - 10m'.
    Returns dict with height, height_min, height_max (all in mm).
    """
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        raise ValueError('Room height is required')

    if isinstance(raw, (int, float)):
        height = float(raw)
        if height <= 0:
            raise ValueError('Room height must be greater than 0')
        return {'height': height, 'height_min': height, 'height_max': height}

    text = str(raw).strip().lower()
    text = re.sub(r'\bmm\b', '', text)
    text = re.sub(r'\bm\b', '', text)
    text = text.strip()

    range_match = re.match(
        r'^([\d.]+)\s*(?:-|–|—|\.\.|to)\s*([\d.]+)$',
        text,
        flags=re.IGNORECASE,
    )
    if range_match:
        minimum = _to_mm(range_match.group(1))
        maximum = _to_mm(range_match.group(2))
        if minimum > maximum:
            minimum, maximum = maximum, minimum
        return {'height': maximum, 'height_min': minimum, 'height_max': maximum}

    height = _to_mm(text)
    return {'height': height, 'height_min': height, 'height_max': height}


def normalize_room_height_fields(room_data):
    """Ensure height, height_min, and height_max are consistent on room payloads."""
    if room_data.get('height_min') is not None and room_data.get('height_max') is not None:
        minimum = float(room_data['height_min'])
        maximum = float(room_data['height_max'])
        if minimum > maximum:
            minimum, maximum = maximum, minimum
        room_data['height_min'] = minimum
        room_data['height_max'] = maximum
        room_data['height'] = maximum
        return room_data

    if room_data.get('height') is not None:
        if isinstance(room_data['height'], str):
            parsed = parse_height_input(room_data['height'])
            room_data.update(parsed)
            return room_data
        height = float(room_data['height'])
        room_data['height'] = height
        room_data['height_min'] = height
        room_data['height_max'] = height

    return room_data
