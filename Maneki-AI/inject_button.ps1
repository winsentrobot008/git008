$app = Get-Content app.py
$code = @"

def render_factory_trigger():
    import streamlit as st
    st.subheader('?? AI Factory Control')
    if st.button('Trigger Factory Task (deploy)'):
        st.write('Running factory task...')
        import subprocess
        res = subprocess.run(['python', 'run_task.py', 'deploy'], capture_output=True, text=True)
        st.text_area('Execution Log:', value=res.stdout + res.stderr, height=300)

render_factory_trigger()
