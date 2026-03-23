
import api from "./client";
export const getStudents = ()=>api.get("/students");
export const createStudent = (d)=>api.post("/students", d);
export const deleteStudent = (id)=>api.delete(`/students/${id}`);
