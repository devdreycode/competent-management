def check_kentucky_shift(age, school_week, shift_start, shift_end):

    # Example starter rule
    if age < 16:

        if school_week and shift_end > 19:
            return {
                "legal": False,
                "reason": "15-year-olds cannot work past 7PM during school weeks in Kentucky"
            }

        if not school_week and shift_end > 21:
            return {
                "legal": False,
                "reason": "15-year-olds cannot work past 9PM during summer in Kentucky"
            }

    return {
        "legal": True,
        "reason": "Shift allowed"
    }