import re


def _parse_number(value):
    number = float(value)
    return number


def parse_temperature_input(raw):
    """Parse '5', '2-6', or '2 - 6' into temperature fields."""
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        raise ValueError('Temperature is required')

    if isinstance(raw, (int, float)):
        temp = float(raw)
        return {'temperature': temp, 'temperature_min': temp, 'temperature_max': temp}

    text = str(raw).strip().lower()
    text = re.sub(r'°c', '', text)
    text = re.sub(r'\bc\b', '', text)
    text = text.strip()

    range_match = re.match(
        r'^(-?[\d.]+)\s*(?:-|–|—|\.\.|to)\s*(-?[\d.]+)$',
        text,
        flags=re.IGNORECASE,
    )
    if range_match:
        first = _parse_number(range_match.group(1))
        second = _parse_number(range_match.group(2))
        minimum = min(first, second)
        maximum = max(first, second)
        return {
            'temperature': maximum,
            'temperature_min': minimum,
            'temperature_max': maximum,
        }

    temp = _parse_number(text)
    return {'temperature': temp, 'temperature_min': temp, 'temperature_max': temp}


def normalize_room_temperature_fields(room_data):
    if room_data.get('temperature_min') is not None and room_data.get('temperature_max') is not None:
        minimum = float(room_data['temperature_min'])
        maximum = float(room_data['temperature_max'])
        if minimum > maximum:
            minimum, maximum = maximum, minimum
        room_data['temperature_min'] = minimum
        room_data['temperature_max'] = maximum
        room_data['temperature'] = maximum
        return room_data

    if room_data.get('temperature') is not None:
        if isinstance(room_data['temperature'], str):
            parsed = parse_temperature_input(room_data['temperature'])
            room_data.update(parsed)
            return room_data
        temp = float(room_data['temperature'])
        room_data['temperature'] = temp
        room_data['temperature_min'] = temp
        room_data['temperature_max'] = temp

    return room_data
