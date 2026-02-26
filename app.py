from flask import Flask, jsonify
import json
from flask_cors import CORS   


app = Flask(__name__)
CORS(app)                   

@app.route('/parking_status')
def parking_status():
    try:
        with open("parking_state.json", "r") as f:
            data = json.load(f)
    except Exception as e:
        data = []
    return jsonify(data)

if __name__ == '__main__':
    app.run(debug=True, host="0.0.0.0")