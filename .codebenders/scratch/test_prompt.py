import sys
sys.path.insert(0, 'server')
import sqlite3
import agent_chat

conn = sqlite3.connect('server/data/cashpulse.db')
conn.row_factory = sqlite3.Row
user_id = 'user_2eac29ef440bf4c5'

hist = [
    {'role': 'user', 'content': 'add customer Ayaan with phone 1234567892'},
    {'role': 'assistant', 'content': "I've completed the requested action(s) for your clinic."},
]
print("--- TEST 1: create a invoice for Rs 5000 for Ayaan ---")
res1 = agent_chat.handle_chat(conn, user_id, 'create a invoice for Rs 5000 for Ayaan', hist)
print(res1)

print("\n--- TEST 2: put 5000 on Ayaan's tab ---")
hist.append({'role': 'user', 'content': 'create a invoice for Rs 5000 for Ayaan'})
hist.append({'role': 'assistant', 'content': res1.get('message', '')})
res2 = agent_chat.handle_chat(conn, user_id, "put 5000 on Ayaan's tab", hist)
print(res2)

