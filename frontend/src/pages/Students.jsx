
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getStudents, deleteStudent } from "../api/students";
import Card from "../components/ui/Card";

export default function Students(){
 const qc = useQueryClient();
 const {data,isLoading} = useQuery({queryKey:["students"],queryFn:getStudents});
 const del = useMutation({mutationFn:deleteStudent,onSuccess:()=>qc.invalidateQueries(["students"])});

 if(isLoading) return <p>Loading...</p>;

 return (
  <Card title="Students">
    {data?.data?.map(s=>(
      <div key={s.id} className="flex justify-between border p-2 mb-2">
        <span>{s.name}</span>
        <button onClick={()=>del.mutate(s.id)}>Delete</button>
      </div>
    ))}
  </Card>
 );
}
