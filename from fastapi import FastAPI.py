from fastapi import FastAPI
from pydantic import BaseModel
from rules.kentucky import check_kentucky_shift

app = FastAPI()

class ShiftRequest(BaseModel):
    state: str
    age: int
    school_week: bool
    shift_start: int
    shift_end: int

@app.get("/")
def home():
    return {"message": "Minor Labor Law API Running"}

@app.post("/check-shift")
def check_shift(data: ShiftRequest):

    if data.state == "KY":
        result = check_kentucky_shift(
            age=data.age,
            school_week=data.school_week,
            shift_start=data.shift_start,
            shift_end=data.shift_end
        )

        return result

    return {
        "legal": False,
        "reason": "State not supported yet"
    }