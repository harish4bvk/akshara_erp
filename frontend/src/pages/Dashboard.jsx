
import Card from "../components/ui/Card";
export default function Dashboard(){
 return (
  <div className="grid grid-cols-3 gap-4">
    <Card title="Students"><p>320</p></Card>
    <Card title="Fees"><p>₹1,20,000</p></Card>
    <Card title="Pending"><p>₹30,000</p></Card>
  </div>
 );
}
